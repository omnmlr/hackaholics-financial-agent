package app.agus.testfixture;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.solana.mobilewalletadapter.clientlib.protocol.JsonRpc20Client.JsonRpc20RemoteException;
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationIntentCreator;
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationScenario;
import com.solana.mobilewalletadapter.common.ProtocolContract;

import java.math.BigInteger;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

public final class MainActivity extends Activity {
    private static final String TEST_WALLET = "com.solana.mobilewalletadapter.fakewallet";
    private static final String BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    private TextView status;
    private Button send;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(36, 64, 36, 24);
        TextView title = new TextView(this);
        title.setTextSize(26);
        title.setText("AGUS MWA Test Fixture");
        content.addView(title);
        status = new TextView(this);
        status.setText("Local validator / disposable wallet");
        content.addView(status);
        send = new Button(this);
        send.setId(android.R.id.button1);
        send.setText("Send test SOL");
        send.setOnClickListener(view -> startWallet());
        content.addView(send);
        setContentView(content);
    }

    private void startWallet() {
        send.setEnabled(false);
        status.setText("Waiting for wallet approval");
        LocalAssociationScenario scenario = new LocalAssociationScenario(90000);
        try {
            startActivity(LocalAssociationIntentCreator.createAssociationIntent(
                null, scenario.getPort(), scenario.getSession()).setPackage(TEST_WALLET));
        } catch (ActivityNotFoundException failure) {
            scenario.close();
            failed("NO_WALLET");
            return;
        }
        new Thread(() -> {
            String phase = "ASSOCIATION";
            try {
                var client = scenario.start().get(30, TimeUnit.SECONDS);
                phase = "WALLET_ERROR";
                var account = client.authorize(null, null, "AGUS MWA Test Fixture", "solana:localnet",
                    null, null, null, null).get(90, TimeUnit.SECONDS);
                String payer = base58(account.accounts[0].publicKey);
                phase = "PREPARE";
                byte[] unsigned = prepare(payer);
                phase = "WALLET_ERROR";
                var sent = client.signAndSendTransactions(new byte[][]{unsigned}, null, "confirmed",
                    false, 0, true).get(90, TimeUnit.SECONDS);
                String signature = base58(sent.signatures[0]);
                finish(new JSONObject().put("outcome", "submitted").put("payer", payer)
                    .put("signature", signature), "Wallet returned a signature");
            } catch (Exception failure) {
                Throwable cause = failure.getCause();
                if (cause instanceof JsonRpc20RemoteException &&
                    (((JsonRpc20RemoteException) cause).code == ProtocolContract.ERROR_NOT_SIGNED ||
                     ((JsonRpc20RemoteException) cause).code == ProtocolContract.ERROR_AUTHORIZATION_FAILED)) {
                    phase = "DECLINED";
                }
                Log.w("AGUS_FIXTURE", phase + " / " + failure.getClass().getSimpleName() +
                    (cause == null ? "" : " / " + cause.getClass().getSimpleName()));
                failed(phase);
            } finally {
                try { scenario.close().get(5, TimeUnit.SECONDS); } catch (Exception ignored) { }
            }
        }, "mwa-test").start();
    }

    private static byte[] prepare(String payer) throws Exception {
        URL url = new URL("http://127.0.0.1:8898/prepare/" + payer);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(5000);
        connection.setReadTimeout(25000);
        connection.setInstanceFollowRedirects(false);
        try (var body = connection.getInputStream()) {
            byte[] bytes = body.readNBytes(2049);
            if (bytes.length > 2048) throw new IllegalStateException("Invalid transaction size");
            return Base64.decode(new String(bytes, StandardCharsets.US_ASCII), Base64.DEFAULT);
        } finally { connection.disconnect(); }
    }

    private void failed(String code) {
        try { finish(new JSONObject().put("outcome", "failed").put("code", code), "Wallet result: " + code); }
        catch (Exception impossible) { throw new IllegalStateException(impossible); }
    }

    private void finish(JSONObject event, String message) {
        Log.i("AGUS_TEST", event.toString());
        runOnUiThread(() -> {
            status.setText(message);
            send.setEnabled(true);
        });
    }

    private static String base58(byte[] input) {
        BigInteger value = new BigInteger(1, input);
        StringBuilder encoded = new StringBuilder();
        while (value.signum() > 0) {
            BigInteger[] pair = value.divideAndRemainder(BigInteger.valueOf(58));
            encoded.append(BASE58.charAt(pair[1].intValue()));
            value = pair[0];
        }
        for (byte b : input) {
            if (b != 0) break;
            encoded.append('1');
        }
        return encoded.reverse().toString();
    }
}
