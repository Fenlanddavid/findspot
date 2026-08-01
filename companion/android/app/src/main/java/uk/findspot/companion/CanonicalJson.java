package uk.findspot.companion;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

final class CanonicalJson {
    private CanonicalJson() {}

    static String encode(Object value) {
        if (value == null) return "null";
        if (value instanceof String string) return quote(string);
        if (value instanceof Boolean bool) return bool ? "true" : "false";
        if (value instanceof Number number) return number(number);
        if (value instanceof List<?> list) {
            StringBuilder output = new StringBuilder("[");
            for (int index = 0; index < list.size(); index++) {
                if (index > 0) output.append(',');
                output.append(encode(list.get(index)));
            }
            return output.append(']').toString();
        }
        if (value instanceof Map<?, ?> map) {
            List<String> keys = new ArrayList<>();
            for (Object key : map.keySet()) {
                if (!(key instanceof String string)) throw new IllegalArgumentException("JSON object key is not a string.");
                keys.add(string);
            }
            Collections.sort(keys);
            StringBuilder output = new StringBuilder("{");
            for (int index = 0; index < keys.size(); index++) {
                if (index > 0) output.append(',');
                String key = keys.get(index);
                output.append(quote(key)).append(':').append(encode(map.get(key)));
            }
            return output.append('}').toString();
        }
        throw new IllegalArgumentException("Unsupported canonical JSON value: " + value.getClass());
    }

    private static String number(Number number) {
        if (number instanceof Byte || number instanceof Short || number instanceof Integer || number instanceof Long) {
            return number.toString();
        }
        double value = number.doubleValue();
        if (!Double.isFinite(value)) throw new IllegalArgumentException("JSON number is not finite.");
        if (value == 0d) return "0";
        double absolute = Math.abs(value);
        BigDecimal decimal = BigDecimal.valueOf(value).stripTrailingZeros();
        if (absolute >= 1e-6 && absolute < 1e21) return decimal.toPlainString();
        String scientific = decimal.toString().replace('E', 'e');
        int exponent = scientific.indexOf('e');
        if (exponent < 0) return scientific;
        String mantissa = scientific.substring(0, exponent);
        int exponentValue = Integer.parseInt(scientific.substring(exponent + 1));
        return mantissa + "e" + (exponentValue >= 0 ? "+" : "") + exponentValue;
    }

    private static String quote(String value) {
        StringBuilder output = new StringBuilder(value.length() + 2).append('"');
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> output.append("\\\"");
                case '\\' -> output.append("\\\\");
                case '\b' -> output.append("\\b");
                case '\f' -> output.append("\\f");
                case '\n' -> output.append("\\n");
                case '\r' -> output.append("\\r");
                case '\t' -> output.append("\\t");
                default -> {
                    if (character < 0x20) output.append(String.format("\\u%04x", (int) character));
                    else output.append(character);
                }
            }
        }
        return output.append('"').toString();
    }
}
