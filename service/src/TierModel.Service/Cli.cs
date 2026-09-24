using Microsoft.EntityFrameworkCore;
using TierModel.Service.Auth;
using TierModel.Service.Config;
using TierModel.Service.Data;

namespace TierModel.Service;

/// <summary>
/// Maintenance commands, used by the installer:
/// <code>
///   TierModel.Service migrate
///   TierModel.Service admin create --username NAME [--display "NAME"]   (password: first line of stdin)
///   TierModel.Service admin reset-password --username NAME             (password: first line of stdin)
///   TierModel.Service db provision --host H [--port 5432] [--ssl-mode Prefer] [--admin-user postgres]
///                                  [--database tiermodel] [--app-user tiermodel]
///                                  (stdin: line 1 = admin password, line 2 = password for the app user)
///   TierModel.Service db test --connection "..."                         (checks a connection string)
/// </code>
/// Passwords are read from stdin so they never appear in process listings or shell history.
/// </summary>
public static partial class Cli
{
    public static bool IsCommand(string arg) => arg is "migrate" or "admin" or "db";

    public static async Task<int> RunAsync(IServiceProvider services, string[] args)
    {
        // The installer writes UTF-8 to stdin; the Windows console default (OEM code page) would garble non-ASCII passwords.
        try
        {
            if (Console.IsInputRedirected) Console.InputEncoding = new System.Text.UTF8Encoding(false);
        }
        catch (IOException)
        {
            // No console attached; stdin is then read with the default encoding.
        }
        if (args[0] == "db") return await DatabaseCommandAsync(args);

        await using var scope = services.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        try
        {
            var db = sp.GetRequiredService<AppDbContext>();
            await db.Database.MigrateAsync();
            await sp.GetRequiredService<TierModel.Service.Domains.DomainRegistry>().InitializeAsync(db, sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<TierModelOptions>>().Value);
            await sp.GetRequiredService<ConfigService>().SeedAsync();
            if (args[0] == "migrate")
            {
                Console.WriteLine("Datenbank ist aktuell.");
                return 0;
            }

            var sub = args.Length > 1 ? args[1] : "";
            var username = Option(args, "--username");
            if (string.IsNullOrWhiteSpace(username)) return Fail("--username fehlt.");
            var password = Console.In.ReadLine() ?? "";
            if (AuthClaims.PasswordProblem(password) is { } problem) return Fail(problem);

            var users = sp.GetRequiredService<UserService>();
            var log = sp.GetRequiredService<ChangeLogService>();
            var existing = await users.FindByNameAsync(username);
            switch (sub)
            {
                case "create":
                    if (existing is not null) return Fail($"Benutzer '{username}' existiert bereits.");
                    if (!AuthClaims.UsernamePattern().IsMatch(username)) return Fail("Ungültiger Benutzername.");
                    var user = users.Create(username, Option(args, "--display") ?? username, Role.Admin, password, mustChange: false);
                    log.Add("installer", "user.create", "user", user.Id.ToString(), $"Administrator '{user.Username}' durch Installation angelegt");
                    break;
                case "reset-password":
                    if (existing is null) return Fail($"Benutzer '{username}' existiert nicht.");
                    users.SetPassword(existing, password, mustChange: false);
                    existing.IsActive = true;
                    log.Add("installer", "user.reset-password", "user", existing.Id.ToString(), $"Passwort von '{existing.Username}' über die Kommandozeile zurückgesetzt");
                    break;
                default:
                    return Fail("Unbekannter Befehl. Erwartet: admin create | admin reset-password");
            }
            await db.SaveChangesAsync();
            Console.WriteLine("OK");
            return 0;
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    [System.Text.RegularExpressions.GeneratedRegex("^[a-z_][a-z0-9_]{0,62}$")]
    private static partial System.Text.RegularExpressions.Regex Identifier();

    /// <summary>Creates (or updates the password of) the application role and database. Idempotent.</summary>
    private static async Task<int> DatabaseCommandAsync(string[] args)
    {
        try
        {
            var sub = args.Length > 1 ? args[1] : "";
            if (sub == "test")
            {
                await using var test = new Npgsql.NpgsqlConnection(Option(args, "--connection") ?? Console.In.ReadLine());
                await test.OpenAsync();
                Console.WriteLine($"OK: PostgreSQL {test.PostgreSqlVersion}");
                return 0;
            }
            if (sub != "provision") return Fail("Unbekannter Befehl. Erwartet: db provision | db test");

            var database = Option(args, "--database") ?? "tiermodel";
            var appUser = Option(args, "--app-user") ?? "tiermodel";
            if (!Identifier().IsMatch(database) || !Identifier().IsMatch(appUser))
                return Fail("Datenbank- und Benutzername: nur Kleinbuchstaben, Ziffern und _ (beginnend mit Buchstabe).");
            var adminPassword = Console.In.ReadLine() ?? "";
            var appPassword = Console.In.ReadLine() ?? "";
            if (appPassword.Length < 16) return Fail("Das Passwort für den Anwendungsbenutzer muss mindestens 16 Zeichen haben.");

            var csb = new Npgsql.NpgsqlConnectionStringBuilder
            {
                Host = Option(args, "--host") ?? "localhost",
                Port = int.Parse(Option(args, "--port") ?? "5432"),
                Username = Option(args, "--admin-user") ?? "postgres",
                Password = adminPassword,
                Database = "postgres",
                SslMode = Enum.Parse<Npgsql.SslMode>(Option(args, "--ssl-mode") ?? "Prefer", ignoreCase: true),
            };
            await using var conn = new Npgsql.NpgsqlConnection(csb.ConnectionString);
            await conn.OpenAsync();

            // DDL cannot take parameters: identifiers are regex-checked above, the password literal is quote-escaped.
            var pwLiteral = "'" + appPassword.Replace("'", "''") + "'";
            var roleExists = await ScalarAsync(conn, "SELECT 1 FROM pg_roles WHERE rolname = @n", appUser) is not null;
            await ExecAsync(conn, roleExists
                ? $"ALTER ROLE \"{appUser}\" WITH LOGIN PASSWORD {pwLiteral}"
                : $"CREATE ROLE \"{appUser}\" WITH LOGIN PASSWORD {pwLiteral}");
            Console.WriteLine(roleExists ? $"Rolle '{appUser}' aktualisiert." : $"Rolle '{appUser}' angelegt.");

            var dbExists = await ScalarAsync(conn, "SELECT 1 FROM pg_database WHERE datname = @n", database) is not null;
            if (!dbExists)
            {
                await ExecAsync(conn, $"CREATE DATABASE \"{database}\" OWNER \"{appUser}\" ENCODING 'UTF8'");
                Console.WriteLine($"Datenbank '{database}' angelegt.");
            }
            else
            {
                await ExecAsync(conn, $"ALTER DATABASE \"{database}\" OWNER TO \"{appUser}\"");
                Console.WriteLine($"Datenbank '{database}' existiert bereits.");
            }
            await ExecAsync(conn, $"REVOKE ALL ON DATABASE \"{database}\" FROM PUBLIC");
            Console.WriteLine("OK");
            return 0;
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    private static async Task<object?> ScalarAsync(Npgsql.NpgsqlConnection conn, string sql, string name)
    {
        await using var cmd = new Npgsql.NpgsqlCommand(sql, conn);
        cmd.Parameters.AddWithValue("n", name);
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task ExecAsync(Npgsql.NpgsqlConnection conn, string sql)
    {
        await using var cmd = new Npgsql.NpgsqlCommand(sql, conn);
        await cmd.ExecuteNonQueryAsync();
    }

    private static string? Option(string[] args, string name)
    {
        var i = Array.IndexOf(args, name);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    private static int Fail(string message)
    {
        Console.Error.WriteLine("FEHLER: " + message);
        return 1;
    }
}
