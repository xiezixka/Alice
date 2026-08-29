package whisper

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

func TestWriteWAVFileWritesValidPCMHeader(t *testing.T) {
	tmpDir := t.TempDir()
	path := filepath.Join(tmpDir, "sample.wav")
	samples := []float32{0, 0.25, -0.25, 1}

	service := NewSTTService(&Config{SampleRate: 16000})
	if err := service.writeWAVFile(path, samples); err != nil {
		t.Fatalf("writeWAVFile() error = %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read generated wav: %v", err)
	}

	wantLength := 44 + len(samples)*2
	if len(data) != wantLength {
		t.Fatalf("unexpected WAV length: got %d, want %d", len(data), wantLength)
	}
	if string(data[0:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		t.Fatalf("invalid RIFF/WAVE header: %q / %q", data[0:4], data[8:12])
	}
	if string(data[36:40]) != "data" {
		t.Fatalf("data chunk marker = %q, want %q", data[36:40], "data")
	}
	if got := binary.LittleEndian.Uint32(data[40:44]); got != uint32(len(samples)*2) {
		t.Fatalf("data chunk size = %d, want %d", got, len(samples)*2)
	}
}
