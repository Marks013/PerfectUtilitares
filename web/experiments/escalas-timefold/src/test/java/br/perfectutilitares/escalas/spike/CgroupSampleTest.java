package br.perfectutilitares.escalas.spike;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import static org.junit.jupiter.api.Assertions.*;

class CgroupSampleTest {
    @TempDir Path directory;
    private final ObjectMapper json = new ObjectMapper();

    private void write(String path, String contents) throws Exception {
        Files.writeString(directory.resolve(path), contents);
    }
    @Test void readsWholeContainerCountersAndLimits() throws Exception {
        write("cpu.stat", "usage_usec 1234567\nuser_usec 1000000\n");
        write("cpu.max", "100000 100000\n");
        write("memory.max", "1610612736\n");
        write("memory.peak", "167772160\n");
        write("pids.max", "64\n");
        var sample = CgroupSample.read(json, directory);
        assertNotNull(sample);
        assertEquals(1234567, sample.path("cpuUsageUsec").longValue());
        assertEquals(167772160, sample.path("memoryPeakBytes").longValue());
        assertEquals(1610612736, sample.path("memoryLimitBytes").longValue());
        assertEquals(100000, sample.path("cpuQuotaUsec").longValue());
        assertEquals(100000, sample.path("cpuPeriodUsec").longValue());
        assertEquals(64, sample.path("pidsLimit").longValue());
        assertEquals("container-before-response", sample.path("scope").asText());
        write("cpu.max", "max 100000\n");
        assertNull(CgroupSample.read(json, directory));
    }
    @Test void unavailableCountersAreNotInvented() {
        assertNull(CgroupSample.read(json, directory));
    }
}
