package embedded

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestArchiveTargetPathRejectsTraversal(t *testing.T) {
	base := t.TempDir()
	outside := filepath.Join(filepath.Dir(base), "alice-archive-escape.txt")

	for _, name := range []string{
		"../alice-archive-escape.txt",
		"nested/../../alice-archive-escape.txt",
		"/tmp/alice-archive-escape.txt",
	} {
		if _, err := archiveTargetPath(base, name); err == nil {
			t.Fatalf("archiveTargetPath(%q) accepted an unsafe path", name)
		}
	}

	safe, err := archiveTargetPath(base, "voices/zh_CN-huayan-medium.onnx")
	if err != nil {
		t.Fatalf("safe archive entry was rejected: %v", err)
	}
	want := filepath.Join(base, "voices", "zh_CN-huayan-medium.onnx")
	if safe != want {
		t.Fatalf("safe path = %q, want %q", safe, want)
	}
	if _, err := os.Stat(outside); !os.IsNotExist(err) {
		t.Fatalf("test setup unexpectedly found escape target %s", outside)
	}
}

func TestExtractZipFileRejectsTraversal(t *testing.T) {
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	entry, err := writer.Create("../../alice-zip-escape.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("must not be extracted")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(archive.Bytes()), int64(archive.Len()))
	if err != nil {
		t.Fatal(err)
	}

	manager := NewAssetManager(t.TempDir())
	if err := manager.extractZipFile(reader.File[0], manager.baseDir); err == nil {
		t.Fatal("extractZipFile accepted a traversal entry")
	}
}

func TestExtractTarFileRejectsTraversal(t *testing.T) {
	var archive bytes.Buffer
	writer := tar.NewWriter(&archive)
	if err := writer.WriteHeader(&tar.Header{
		Name: "../../alice-tar-escape.txt",
		Mode: 0o644,
		Size: int64(len("must not be extracted")),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte("must not be extracted")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	reader := tar.NewReader(bytes.NewReader(archive.Bytes()))
	header, err := reader.Next()
	if err != nil {
		t.Fatal(err)
	}

	manager := NewAssetManager(t.TempDir())
	if err := manager.extractTarFile(reader, header, manager.baseDir); err == nil {
		t.Fatal("extractTarFile accepted a traversal entry")
	}
}
