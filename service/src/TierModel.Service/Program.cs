using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using TierModel.Service;
using TierModel.Service.Auth;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Endpoints;
using TierModel.Service.Notifications;
using TierModel.Service.Runs;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    // As a Windows service the working directory is System32; resolve everything next to the executable.
    ContentRootPath = AppContext.BaseDirectory,
});

builder.Host.UseWindowsService(o => o.ServiceName = "TierModelService");

var options = builder.Configuration.GetSection("TierModel").Get<TierModelOptions>() ?? new TierModelOptions();
if (string.IsNullOrWhiteSpace(options.FrameworkPath))
    options.FrameworkPath = Path.Combine(AppContext.BaseDirectory, "framework");
if (string.IsNullOrWhiteSpace(options.WorkPath))
    options.WorkPath = Path.Combine(AppContext.BaseDirectory, "data");
// Relative paths are relative to the executable, not the (service) working directory.
options.FrameworkPath = Path.GetFullPath(options.FrameworkPath, AppContext.BaseDirectory);
options.WorkPath = Path.GetFullPath(options.WorkPath, AppContext.BaseDirectory);
if (options.PwshPath.Contains('/') || options.PwshPath.Contains('\\'))
    options.PwshPath = Path.GetFullPath(options.PwshPath, AppContext.BaseDirectory);
builder.Services.Configure<TierModelOptions>(o =>
{
    builder.Configuration.GetSection("TierModel").Bind(o);
    o.FrameworkPath = options.FrameworkPath;
    o.WorkPath = options.WorkPath;
    o.PwshPath = options.PwshPath;
});

// HTTPS certificate from the Windows certificate store (LocalMachine\My), selected by thumbprint.
var isCli = args.Length > 0 && Cli.IsCommand(args[0]);
if (!isCli && !string.IsNullOrWhiteSpace(options.CertificateThumbprint))
{
    var certificate = CertificateLoader.FromStore(options.CertificateThumbprint);
    builder.WebHost.ConfigureKestrel(k => k.ConfigureHttpsDefaults(h => h.ServerCertificate = certificate));
}

var connectionString = builder.Configuration.GetConnectionString("TierModel")
    ?? throw new InvalidOperationException("ConnectionStrings:TierModel fehlt in appsettings.json.");
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(connectionString));

// Keys protecting the auth/antiforgery cookies: persisted next to the run data so sessions survive restarts
// (a gMSA has no loaded user profile), encrypted with DPAPI for the service account on Windows.
var dataProtection = builder.Services.AddDataProtection()
    .SetApplicationName("TierModelService")
    .PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(options.WorkPath, "keys")));
if (OperatingSystem.IsWindows()) dataProtection.ProtectKeysWithDpapi();

builder.Services.ConfigureHttpJsonOptions(o => JsonDefaults.Configure(o.SerializerOptions));
builder.Services.AddProblemDetails();
builder.Services.AddTierModelAuth(options.RequireHttps);
builder.Services.AddScoped<ChangeLogService>();
builder.Services.AddScoped<SettingsService>();
builder.Services.AddScoped<ConfigService>();
builder.Services.AddScoped<RunService>();
builder.Services.AddSingleton<RunQueue>();
builder.Services.AddSingleton<NotificationQueue>();
builder.Services.AddScoped<NotificationService>();
builder.Services.AddHttpClient("notifications", c => c.Timeout = TimeSpan.FromSeconds(20));

// Command-line maintenance used by the installer: runs without starting the web server.
if (isCli)
{
    var cliApp = builder.Build();
    return await Cli.RunAsync(cliApp.Services, args);
}

builder.Services.AddHostedService<RunWorker>();
builder.Services.AddHostedService<ScheduleWorker>();
builder.Services.AddHostedService<NotificationWorker>();

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
    await scope.ServiceProvider.GetRequiredService<ConfigService>().SeedAsync();
    if (!await scope.ServiceProvider.GetRequiredService<AppDbContext>().Users.AnyAsync())
        app.Logger.LogWarning("Es existiert noch kein Benutzer. Anlegen mit: TierModel.Service.exe admin create --username <name>");
}

app.UseExceptionHandler();
if (options.RequireHttps)
{
    app.UseHsts();
    app.UseHttpsRedirection();
}
app.UseDefaultFiles();
// Hashed build assets can be cached forever; index.html must always be revalidated so an update
// never leaves browsers with an old page that references assets which no longer exist.
static void CacheHeaders(Microsoft.AspNetCore.StaticFiles.StaticFileResponseContext ctx) =>
    ctx.Context.Response.Headers.CacheControl = ctx.File.Name == "index.html" ? "no-cache" : "public, max-age=31536000, immutable";
app.UseStaticFiles(new StaticFileOptions { OnPrepareResponse = CacheHeaders });
app.UseAuthentication();
app.UseTierModelSecurity();
app.UseRateLimiter();
app.UseAuthorization();

app.MapAuthEndpoints();
app.MapConfigEndpoints();
app.MapRunEndpoints();
app.MapMiscEndpoints();
app.MapWindowsAuthSettings();
app.MapNotificationEndpoints();
app.Map("/api/{**rest}", () => Results.Problem(title: "Nicht gefunden", statusCode: 404));
app.MapFallbackToFile("index.html", new StaticFileOptions { OnPrepareResponse = CacheHeaders });

app.Run();
return 0;

public partial class Program;
