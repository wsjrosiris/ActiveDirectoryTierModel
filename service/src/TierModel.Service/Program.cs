using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using TierModel.Service;
using TierModel.Service.Auth;
using TierModel.Service.Config;
using TierModel.Service.Data;
using TierModel.Service.Endpoints;
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
if (!string.IsNullOrWhiteSpace(options.CertificateThumbprint))
{
    var certificate = CertificateLoader.FromStore(options.CertificateThumbprint);
    builder.WebHost.ConfigureKestrel(k => k.ConfigureHttpsDefaults(h => h.ServerCertificate = certificate));
}

var connectionString = builder.Configuration.GetConnectionString("TierModel")
    ?? throw new InvalidOperationException("ConnectionStrings:TierModel fehlt in appsettings.json.");
builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(connectionString));

builder.Services.ConfigureHttpJsonOptions(o => JsonDefaults.Configure(o.SerializerOptions));
builder.Services.AddProblemDetails();
builder.Services.AddTierModelAuth(options.RequireHttps);
builder.Services.AddScoped<ChangeLogService>();
builder.Services.AddScoped<SettingsService>();
builder.Services.AddScoped<ConfigService>();
builder.Services.AddScoped<RunService>();
builder.Services.AddSingleton<RunQueue>();

// Command-line maintenance used by the installer: runs without starting the web server.
if (args.Length > 0 && Cli.IsCommand(args[0]))
{
    var cliApp = builder.Build();
    return await Cli.RunAsync(cliApp.Services, args);
}

builder.Services.AddHostedService<RunWorker>();
builder.Services.AddHostedService<ScheduleWorker>();
builder.Services.Configure<ForwardedHeadersOptions>(o => o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);

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
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        // Hashed build assets can be cached forever; index.html must always be revalidated.
        ctx.Context.Response.Headers.CacheControl = ctx.File.Name == "index.html" ? "no-cache" : "public, max-age=31536000, immutable";
    },
});
app.UseAuthentication();
app.UseTierModelSecurity();
app.UseRateLimiter();
app.UseAuthorization();

app.MapAuthEndpoints();
app.MapConfigEndpoints();
app.MapRunEndpoints();
app.MapMiscEndpoints();
app.Map("/api/{**rest}", () => Results.Problem(title: "Nicht gefunden", statusCode: 404));
app.MapFallbackToFile("index.html");

app.Run();
return 0;

public partial class Program;
