using System.Globalization;
using Microsoft.AspNetCore.Localization;

namespace TierModel.Service.Localization;

/// <summary>
/// Request language (roadmap 25): <c>?lang=de|en</c> (browser navigations such as report previews), otherwise the
/// Accept-Language header – the web client sends its active UI language. Without either (e.g. API clients) German.
/// Only the UI culture changes; number and date formatting in German texts keeps the process culture as before.
/// </summary>
public static class LocalizationSetup
{
    public static void UseTierModelLocalization(this WebApplication app)
    {
        var process = CultureInfo.CurrentCulture;
        var options = new RequestLocalizationOptions
        {
            DefaultRequestCulture = new RequestCulture(process, CultureInfo.GetCultureInfo(L.German)),
            SupportedCultures = [process],
            SupportedUICultures = [CultureInfo.GetCultureInfo(L.German), CultureInfo.GetCultureInfo(L.EnglishCode)],
            FallBackToParentUICultures = true,
            RequestCultureProviders =
            [
                new QueryStringRequestCultureProvider { QueryStringKey = "lang", UIQueryStringKey = "lang" },
                new AcceptLanguageHeaderRequestCultureProvider(),
            ],
        };
        app.UseRequestLocalization(options);
        app.Use(async (ctx, next) =>
        {
            var ui = ctx.Features.Get<IRequestCultureFeature>()?.RequestCulture.UICulture;
            using var _ = L.Use(ui?.TwoLetterISOLanguageName);
            await next(ctx);
        });
    }
}
