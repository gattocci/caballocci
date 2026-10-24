package com.caballocci.mobilesync;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SyncFolderPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
