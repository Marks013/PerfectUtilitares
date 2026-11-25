package br.perfectutilitares.escalas.spike;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Linux cgroup v2 whole-container counters sampled before reply.
 * Not JVM heap/RSS, host utilization, or a capacity certificate.
 */
final class CgroupSample {
    private CgroupSample() {}

    static ObjectNode read(ObjectMapper json, Path root) {
        try {
            long usage = -1;
            for (String line : Files.readAllLines(root.resolve("cpu.stat"))) {
                String[] fields = line.trim().split("\\s+");
                if (fields.length == 2 && fields[0].equals("usage_usec"))
                    usage = Long.parseLong(fields[1]);
            }
            String[] cpu = Files.readString(root.resolve("cpu.max")).trim().split("\\s+");
            if (cpu.length != 2) return null;
            long quota = Long.parseLong(cpu[0]), period = Long.parseLong(cpu[1]);
            long memory = Long.parseLong(Files.readString(root.resolve("memory.max")).trim());
            long peak = Long.parseLong(Files.readString(root.resolve("memory.peak")).trim());
            long pids = Long.parseLong(Files.readString(root.resolve("pids.max")).trim());
            if (usage < 0 || peak <= 0 || quota <= 0 || period <= 0 || memory <= 0 || pids <= 0) return null;
            ObjectNode sample = json.createObjectNode();
            sample.put("version", 2);
            sample.put("scope", "container-before-response");
            sample.put("cpuUsageUsec", usage);
            sample.put("memoryPeakBytes", peak);
            sample.put("memoryLimitBytes", memory);
            sample.put("cpuQuotaUsec", quota);
            sample.put("cpuPeriodUsec", period);
            sample.put("pidsLimit", pids);
            return sample;
        } catch (IOException | NumberFormatException | SecurityException error) {
            return null;
        }
    }
}
