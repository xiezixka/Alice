package whisper

import (
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func TestHasMeaningfulAudioRejectsSilence(t *testing.T) {
	service := NewSTTService(&Config{VoiceThreshold: 0.02})

	if service.hasMeaningfulAudio(make([]float32, 16000)) {
		t.Fatal("silent samples should be rejected")
	}
	quiet := make([]float32, 16000)
	for index := range quiet {
		quiet[index] = 0.001
	}
	if service.hasMeaningfulAudio(quiet) {
		t.Fatal("near-silent samples should be rejected")
	}
}

func TestHasMeaningfulAudioAcceptsSpeechLikeSignal(t *testing.T) {
	service := NewSTTService(&Config{VoiceThreshold: 0.02})
	samples := make([]float32, 16000)
	for index := range samples {
		samples[index] = float32(math.Sin(float64(index)/16000*math.Pi*2*220) * 0.05)
	}

	if !service.hasMeaningfulAudio(samples) {
		t.Fatal("speech-like samples should pass the energy gate")
	}
}

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
