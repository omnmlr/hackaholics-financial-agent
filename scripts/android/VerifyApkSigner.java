import com.android.apksig.ApkVerifier;
import java.io.File;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.HexFormat;

class VerifyApkSigner {
    private static String sha256(X509Certificate certificate) throws Exception {
        return HexFormat.of().withUpperCase().formatHex(
            MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded())
        );
    }

    public static void main(String[] args) throws Exception {
        var result = new ApkVerifier.Builder(new File(args[0])).build().verify();
        if (!result.isVerified() || !result.isVerifiedUsingV2Scheme()) {
            System.err.println("APK signature verification failed or APK Signature Scheme v2 is missing.");
            System.exit(1);
        }

        var signers = result.getSignerCertificates();
        var v2Signers = result.getV2SchemeSigners();
        if (signers.size() != 1 || v2Signers.size() != 1
                || !sha256(signers.get(0)).equals(args[1])
                || !sha256(v2Signers.get(0).getCertificate()).equals(args[1])) {
            System.err.println("APK must have exactly one signer with the approved release certificate.");
            System.exit(1);
        }
    }
}
