package uk.findspot.companion;

import android.util.Xml;

import org.xmlpull.v1.XmlSerializer;

import java.io.IOException;
import java.io.StringWriter;
import java.time.Instant;

final class RecordingGpx {
    static final String MIME_TYPE = "application/gpx+xml";
    private static final String GPX = "http://www.topografix.com/GPX/1/1";
    private static final String FINDSPOT = "https://findspot.app/schema/gpx/1";

    private RecordingGpx() {}

    static String export(RecordingModels.Snapshot snapshot) {
        try {
            StringWriter output = new StringWriter();
            XmlSerializer xml = Xml.newSerializer();
            xml.setOutput(output);
            xml.startDocument("UTF-8", true);
            xml.setPrefix("findspot", FINDSPOT);
            xml.startTag(GPX, "gpx");
            xml.attribute(null, "version", "1.1");
            xml.attribute(null, "creator", "FindSpot Companion " + BuildConfig.VERSION_NAME);
            xml.startTag(GPX, "trk");
            element(xml, GPX, "name", "FindSpot Companion recording");
            for (RecordingModels.Segment segment : snapshot.segments()) {
                xml.startTag(GPX, "trkseg");
                for (RecordingModels.Point point : segment.observations()) writePoint(xml, point);
                xml.endTag(GPX, "trkseg");
            }
            xml.endTag(GPX, "trk");
            xml.endTag(GPX, "gpx");
            xml.endDocument();
            return output.toString();
        } catch (IOException error) {
            throw new IllegalStateException("Could not create GPX export.", error);
        }
    }

    private static void writePoint(XmlSerializer xml, RecordingModels.Point point) throws IOException {
        xml.startTag(GPX, "trkpt");
        xml.attribute(null, "lat", Double.toString(point.latitude()));
        xml.attribute(null, "lon", Double.toString(point.longitude()));
        if (point.altitudeM() != null) element(xml, GPX, "ele", Double.toString(point.altitudeM()));
        element(xml, GPX, "time", Instant.ofEpochMilli(point.timestampUtc()).toString());
        xml.startTag(GPX, "extensions");
        optional(xml, "horizontalAccuracyM", point.horizontalAccuracyM());
        optional(xml, "verticalAccuracyM", point.verticalAccuracyM());
        optional(xml, "headingDegrees", point.headingDegrees());
        optional(xml, "speedMps", point.speedMps());
        element(xml, FINDSPOT, "provider", point.provider());
        element(xml, FINDSPOT, "sequence", Long.toString(point.sequence()));
        xml.endTag(GPX, "extensions");
        xml.endTag(GPX, "trkpt");
    }

    private static void optional(XmlSerializer xml, String name, Double value) throws IOException {
        if (value != null) element(xml, FINDSPOT, name, Double.toString(value));
    }

    private static void element(XmlSerializer xml, String namespace, String name, String value) throws IOException {
        xml.startTag(namespace, name);
        xml.text(value);
        xml.endTag(namespace, name);
    }
}
