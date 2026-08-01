package uk.findspot.companion;

import android.content.Context;
import android.net.Uri;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

final class ExportFiles {
    private ExportFiles() {}

    static Uri json(Context context, RecordingModels.Snapshot snapshot) throws IOException {
        return write(
            context,
            "findspot-" + snapshot.summary().uuid() + ".findspot.json",
            RecordingJson.export(snapshot)
        );
    }

    static Uri gpx(Context context, RecordingModels.Snapshot snapshot) throws IOException {
        return write(
            context,
            "findspot-" + snapshot.summary().uuid() + ".gpx",
            RecordingGpx.export(snapshot)
        );
    }

    private static Uri write(Context context, String filename, String contents) throws IOException {
        File directory = new File(context.getCacheDir(), "exports");
        if (!directory.exists() && !directory.mkdirs()) throw new IOException("Could not create export directory.");
        File file = new File(directory, filename);
        try (FileOutputStream output = new FileOutputStream(file, false)) {
            output.write(contents.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        return FileProvider.getUriForFile(context, BuildConfig.APPLICATION_ID + ".files", file);
    }
}
