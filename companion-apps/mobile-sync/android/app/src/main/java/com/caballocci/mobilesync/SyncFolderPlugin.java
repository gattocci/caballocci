package com.caballocci.mobilesync;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.UUID;
import java.util.ArrayList;
import androidx.core.content.FileProvider;

@CapacitorPlugin(name = "SyncFolder")
public class SyncFolderPlugin extends Plugin {
    private static final String PREFS = "caballocci-mobile-sync";
    private static final String TREE_URI = "tree-uri";

    @PluginMethod
    public void installUpdate(PluginCall call) {
        try {
            String url = call.getString("url");
            if (url == null || !url.startsWith("https://github.com/")) {
                call.reject("El enlace de actualización no es válido.");
                return;
            }
            File apk = new File(getContext().getCacheDir(), "caballocci-update-" + Integer.toHexString(url.hashCode()) + ".apk");
            if (!apk.isFile() || apk.length() == 0) downloadApk(url, apk);
            JSObject result = new JSObject();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
                result.put("permissionRequired", true);
                call.resolve(result);
                Intent settings = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(settings);
                return;
            }
            Uri apkUri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(apkUri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(install);
            result.put("permissionRequired", false);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo descargar o abrir el instalador de Android. Comprueba tu conexión e inténtalo de nuevo.", error);
        }
    }

    private void downloadApk(String address, File destination) throws Exception {
        File temporary = new File(getContext().getCacheDir(), "caballocci-update.apk.part");
        HttpURLConnection connection = null;
        try {
            URL url = new URL(address);
            connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
            connection.connect();
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK || !"https".equalsIgnoreCase(connection.getURL().getProtocol())) {
                throw new IllegalStateException("GitHub no devolvió un APK descargable.");
            }
            long length = connection.getContentLengthLong();
            if (length > 250L * 1024L * 1024L) throw new IllegalStateException("El APK supera el tamaño permitido.");
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(temporary)) {
                byte[] buffer = new byte[32768];
                int read;
                long total = 0;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > 250L * 1024L * 1024L) throw new IllegalStateException("El APK supera el tamaño permitido.");
                    output.write(buffer, 0, read);
                }
                output.getFD().sync();
                if (length > 0 && total != length) throw new IllegalStateException("La descarga del APK quedó incompleta.");
            }
            try (FileInputStream input = new FileInputStream(temporary)) {
                if (input.read() != 'P' || input.read() != 'K') throw new IllegalStateException("El archivo descargado no parece ser un APK válido.");
            }
            if (destination.exists() && !destination.delete()) throw new IllegalStateException("No se pudo preparar la actualización descargada.");
            if (!temporary.renameTo(destination)) throw new IllegalStateException("No se pudo guardar el APK descargado.");
        } finally {
            if (connection != null) connection.disconnect();
            if (temporary.exists()) temporary.delete();
        }
    }

    @PluginMethod
    public void chooseFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
        );
        startActivityForResult(call, intent, "folderSelected");
    }

    @PluginMethod
    public void hasFolder(PluginCall call) {
        JSObject result = new JSObject();
        result.put("selected", preferences().getString(TREE_URI, null) != null);
        call.resolve(result);
    }

    @PluginMethod
    public void getDeviceId(PluginCall call) {
        try {
            String id = preferences().getString("device-id", null);
            if (id == null) {
                id = UUID.randomUUID().toString();
                if (!preferences().edit().putString("device-id", id).commit()) {
                    throw new IllegalStateException("No se pudo conservar el identificador del dispositivo.");
                }
            }
            JSObject result = new JSObject();
            result.put("deviceId", id);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo obtener el identificador local del dispositivo.", error);
        }
    }

    @ActivityCallback
    private void folderSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("No se seleccionó una carpeta compartida.");
            return;
        }
        Uri uri = result.getData().getData();
        int flags = result.getData().getFlags()
            & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
            if (!preferences().edit().putString(TREE_URI, uri.toString()).commit()) {
                throw new IllegalStateException("No se pudo conservar la carpeta seleccionada.");
            }
            JSObject resultObject = new JSObject();
            resultObject.put("uri", uri.toString());
            call.resolve(resultObject);
        } catch (Exception error) {
            call.reject("Android no permitió conservar el acceso a la carpeta.", error);
        }
    }

    @PluginMethod
    public void readText(PluginCall call) {
        read(call, false);
    }

    @PluginMethod
    public void readMedia(PluginCall call) {
        read(call, true);
    }

    @PluginMethod
    public void exists(PluginCall call) {
        try {
            String relativePath = safePath(call.getString("path"));
            JSObject result = new JSObject();
            result.put("exists", findPath(relativePath) != null);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo comprobar el archivo sincronizado.", error);
        }
    }

    @PluginMethod
    public void storeEvent(PluginCall call) {
        File temporary = null;
        try {
            String deviceId = safeName(call.getString("deviceId"));
            String eventId = safeName(call.getString("eventId"));
            String content = call.getString("content");
            if (content == null || content.getBytes(StandardCharsets.UTF_8).length > 256 * 1024) {
                throw new IllegalArgumentException("El evento está vacío o supera 256 KB.");
            }
            File directory = new File(new File(getContext().getFilesDir(), "mobile-sync-outbox"), deviceId);
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("No se pudo crear la cola local de eventos.");
            File destination = new File(directory, eventId + ".json");
            if (destination.exists()) {
                String existing = new String(readLocalFile(destination), StandardCharsets.UTF_8);
                if (!existing.equals(content)) throw new IllegalStateException("El identificador de evento ya existe con contenido diferente.");
                call.resolve();
                return;
            }
            temporary = File.createTempFile(eventId + "-", ".tmp", directory);
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(content.getBytes(StandardCharsets.UTF_8));
                output.flush();
                output.getFD().sync();
            }
            if (!temporary.renameTo(destination)) throw new IllegalStateException("No se pudo finalizar el evento local.");
            temporary = null;
            call.resolve();
        } catch (Exception error) {
            if (temporary != null && temporary.exists() && !temporary.delete()) {
                error.addSuppressed(new IllegalStateException("No se pudo retirar el archivo temporal local."));
            }
            call.reject("No se pudo guardar localmente la confirmación.", error);
        }
    }

    @PluginMethod
    public void listLocalEvents(PluginCall call) {
        try {
            File root = new File(getContext().getFilesDir(), "mobile-sync-outbox");
            JSArray events = new JSArray();
            File[] deviceDirectories = root.listFiles(File::isDirectory);
            if (deviceDirectories != null) {
                for (File directory : deviceDirectories) {
                    File[] eventFiles = directory.listFiles((parent, name) -> name.endsWith(".json"));
                    if (eventFiles == null) continue;
                    for (File file : eventFiles) {
                        events.put(new String(readLocalFile(file), StandardCharsets.UTF_8));
                    }
                }
            }
            JSObject result = new JSObject();
            result.put("events", events);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudieron recuperar las confirmaciones locales.", error);
        }
    }

    private void read(PluginCall call, boolean media) {
        try {
            String relativePath = safePath(call.getString("path"));
            Uri file = findPath(relativePath);
            if (file == null) throw new IllegalStateException("No se encontró el archivo sincronizado: " + relativePath);
            byte[] content = readLimited(file, media ? 32 * 1024 * 1024 : 16 * 1024 * 1024);
            JSObject result = new JSObject();
            if (media) {
                result.put("data", Base64.encodeToString(content, Base64.NO_WRAP));
                String mime = getContext().getContentResolver().getType(file);
                if (mime == null || !mime.startsWith("image/")) {
                    mime = guessImageMime(relativePath);
                }
                result.put("mimeType", mime);
            } else {
                result.put("text", new String(content, StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo leer desde la carpeta compartida.", error);
        }
    }

    @PluginMethod
    public void writeEvent(PluginCall call) {
        Uri temporary = null;
        try {
            String deviceId = safeName(call.getString("deviceId"));
            String eventId = safeName(call.getString("eventId"));
            String content = call.getString("content");
            if (content == null || content.getBytes(StandardCharsets.UTF_8).length > 256 * 1024) {
                throw new IllegalArgumentException("El evento está vacío o supera 256 KB.");
            }
            Uri inbox = ensureDirectory(rootUri(), "android-inbox");
            Uri deviceDirectory = ensureDirectory(inbox, deviceId);
            String eventName = eventId + ".json";
            Uri existing = child(deviceDirectory, eventName);
            JSObject result = new JSObject();
            if (existing != null) {
                result.put("path", "android-inbox/" + deviceId + "/" + eventName);
                result.put("alreadyExists", true);
                call.resolve(result);
                return;
            }
            temporary = DocumentsContract.createDocument(
                getContext().getContentResolver(),
                deviceDirectory,
                "application/octet-stream",
                eventName + ".tmp"
            );
            if (temporary == null) throw new IllegalStateException("No se pudo crear el archivo temporal del evento.");
            try (OutputStream output = getContext().getContentResolver().openOutputStream(temporary, "w")) {
                if (output == null) throw new IllegalStateException("No se pudo abrir el archivo temporal del evento.");
                output.write(content.getBytes(StandardCharsets.UTF_8));
                output.flush();
            }
            Uri completed = DocumentsContract.renameDocument(getContext().getContentResolver(), temporary, eventName);
            if (completed == null) throw new IllegalStateException("No se pudo finalizar el archivo del evento.");
            temporary = null;
            result.put("path", "android-inbox/" + deviceId + "/" + eventName);
            result.put("alreadyExists", false);
            call.resolve(result);
        } catch (Exception error) {
            if (temporary != null) {
                try {
                    DocumentsContract.deleteDocument(getContext().getContentResolver(), temporary);
                } catch (Exception cleanupError) {
                    error.addSuppressed(cleanupError);
                }
            }
            call.reject("No se pudo escribir la confirmación en la carpeta compartida.", error);
        }
    }

    @PluginMethod
    public void deleteAlbum(PluginCall call) {
        try {
            String relativePath = safePath(call.getString("path"));
            String[] parts = relativePath.split("/");
            if (parts.length != 3 || !"pc-outbox".equals(parts[0]) || !"publications".equals(parts[1])
                || parts[2].startsWith(".")) {
                throw new IllegalArgumentException("Solo se permite borrar una carpeta de álbum dentro de pc-outbox/publications.");
            }
            Uri album = findPath(relativePath);
            JSObject result = new JSObject();
            if (album == null) {
                result.put("deleted", false);
                call.resolve(result);
                return;
            }
            if (!isDirectory(album)) throw new IllegalStateException("La ruta del álbum no es una carpeta.");
            deleteDocumentTree(album);
            result.put("deleted", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No se pudo borrar la carpeta del álbum en Syncthing.", error);
        }
    }

    private boolean isDirectory(Uri document) throws Exception {
        try (Cursor cursor = getContext().getContentResolver().query(
            document, new String[] { DocumentsContract.Document.COLUMN_MIME_TYPE }, null, null, null
        )) {
            if (cursor == null || !cursor.moveToFirst()) throw new IllegalStateException("No se pudo verificar la carpeta del álbum.");
            return DocumentsContract.Document.MIME_TYPE_DIR.equals(cursor.getString(0));
        }
    }

    private void deleteDocumentTree(Uri directory) throws Exception {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
            directory, DocumentsContract.getDocumentId(directory)
        );
        ArrayList<Uri> children = new ArrayList<>();
        String[] columns = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        };
        try (Cursor cursor = getContext().getContentResolver().query(childrenUri, columns, null, null, null)) {
            if (cursor == null) throw new IllegalStateException("Syncthing no devolvió el contenido de la carpeta del álbum.");
            while (cursor.moveToNext()) {
                children.add(DocumentsContract.buildDocumentUriUsingTree(directory, cursor.getString(0)));
            }
        }
        for (Uri child : children) {
            if (isDirectory(child)) {
                deleteDocumentTree(child);
                continue;
            }
            if (!DocumentsContract.deleteDocument(getContext().getContentResolver(), child)) {
                throw new IllegalStateException("Syncthing no pudo borrar uno de los archivos del álbum.");
            }
        }
        if (!DocumentsContract.deleteDocument(getContext().getContentResolver(), directory)) {
            throw new IllegalStateException("Syncthing no pudo borrar la carpeta del álbum.");
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFS, Activity.MODE_PRIVATE);
    }

    private Uri rootUri() {
        String value = preferences().getString(TREE_URI, null);
        if (value == null) throw new IllegalStateException("Selecciona la carpeta compartida de Syncthing.");
        Uri treeUri = Uri.parse(value);
        Uri root = DocumentsContract.buildDocumentUriUsingTree(
            treeUri, DocumentsContract.getTreeDocumentId(treeUri)
        );
        try (Cursor cursor = getContext().getContentResolver().query(root, new String[] { DocumentsContract.Document.COLUMN_DOCUMENT_ID }, null, null, null)) {
            if (cursor == null) throw new IllegalStateException("El proveedor de archivos no responde.");
        } catch (SecurityException error) {
            preferences().edit().remove(TREE_URI).apply();
            throw new IllegalStateException("El permiso de Android expiró. Selecciona otra vez la carpeta compartida.", error);
        }
        return root;
    }

    private Uri findPath(String path) throws Exception {
        String[] parts = safePath(path).split("/");
        Uri current = rootUri();
        for (String part : parts) {
            current = child(current, part);
            if (current == null) return null;
        }
        return current;
    }

    private Uri ensureDirectory(Uri parent, String name) throws Exception {
        Uri existing = child(parent, name);
        if (existing != null) return existing;
        Uri created = DocumentsContract.createDocument(
            getContext().getContentResolver(), parent, DocumentsContract.Document.MIME_TYPE_DIR, name
        );
        if (created == null) throw new IllegalStateException("No se pudo crear la carpeta de eventos.");
        return created;
    }

    private Uri child(Uri parent, String name) throws Exception {
        String parentId = DocumentsContract.getDocumentId(parent);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(parent, parentId);
        String[] columns = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME
        };
        try (Cursor cursor = getContext().getContentResolver().query(children, columns, null, null, null)) {
            if (cursor == null) throw new IllegalStateException("El proveedor de archivos no devolvió contenido.");
            while (cursor.moveToNext()) {
                if (name.equals(cursor.getString(1))) {
                    return DocumentsContract.buildDocumentUriUsingTree(parent, cursor.getString(0));
                }
            }
        }
        return null;
    }

    private byte[] readLimited(Uri file, int maximumBytes) throws Exception {
        try (InputStream input = getContext().getContentResolver().openInputStream(file);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) throw new IllegalStateException("No se pudo abrir el archivo.");
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > maximumBytes) throw new IllegalArgumentException("El archivo supera el límite permitido.");
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private byte[] readLocalFile(File file) throws Exception {
        if (file.length() > 256 * 1024) throw new IllegalArgumentException("El evento local supera 256 KB.");
        try (FileInputStream input = new FileInputStream(file);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return output.toByteArray();
        }
    }

    private String safePath(String value) {
        if (value == null || value.isEmpty() || value.startsWith("/") || value.contains("\\")) {
            throw new IllegalArgumentException("Ruta relativa no válida.");
        }
        String[] parts = value.split("/");
        for (String part : parts) {
            if (part.isEmpty() || ".".equals(part) || "..".equals(part)) {
                throw new IllegalArgumentException("Ruta relativa no válida.");
            }
        }
        return value;
    }

    private String safeName(String value) {
        if (value == null || !value.matches("[A-Za-z0-9._:-]{1,128}")) {
            throw new IllegalArgumentException("Identificador no válido.");
        }
        return value;
    }

    private String guessImageMime(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        return "image/jpeg";
    }
}
