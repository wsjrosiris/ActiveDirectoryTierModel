using System.Security.Cryptography.X509Certificates;

namespace TierModel.Service;

public static class CertificateLoader
{
    public static X509Certificate2 FromStore(string thumbprint)
    {
        var clean = new string(thumbprint.Where(Uri.IsHexDigit).ToArray());
        using var store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
        store.Open(OpenFlags.ReadOnly);
        var found = store.Certificates.Find(X509FindType.FindByThumbprint, clean, validOnly: false);
        if (found.Count == 0)
            throw new InvalidOperationException($"Zertifikat mit Fingerabdruck {clean} wurde in LocalMachine\\My nicht gefunden.");
        var cert = found[0];
        if (!cert.HasPrivateKey)
            throw new InvalidOperationException($"Zum Zertifikat {clean} ist kein privater Schlüssel verfügbar (Berechtigung des Dienstkontos prüfen).");
        return cert;
    }
}
