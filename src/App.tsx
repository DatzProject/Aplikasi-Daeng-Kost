import { useState, useEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";

// ── Paste URL Web App Apps Script Anda di sini ───────────
const SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxHi4TUkPb8vt3PeLOAhF2PZZF-WQ7OrMGbD67ReVuajpCcwtsrulKEcQu2Xnxa_cuVAA/exec";

// ── Types ─────────────────────────────────────────────────
interface Penghuni {
  rowIndex: number;
  nama: string;
  kamar: string;
  tanggal: string;
  ktp: string;
  ktpFileId: string;
  ktpUrl: string;
  biaya: number;
  barang: string;
  bulan: number;
}

interface FormData {
  nama: string;
  kamar: string;
  tanggal: string;
  ktp: string;
  ktpFileId: string;
  ktpUrl: string;
  biaya: string;
  barang: string;
  bulan: string;
}

interface UploadResult {
  success: boolean;
  done?: boolean;
  fileId?: string;
  fileName?: string;
  message?: string;
}

// ── Kirim data teks via GET (CORS-safe) ──────────────────
async function callScript(
  params: Record<string, string | number>
): Promise<any> {
  const url = new URL(SCRIPT_URL);
  Object.entries(params).forEach(([k, v]) =>
    url.searchParams.set(k, String(v))
  );
  const res = await fetch(url.toString());
  return res.json();
}

// ── Upload file KTP via POST + no-cors, terima result via polling ──
async function uploadKTP(file: File, namaFile: string): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const result = e.target?.result;
        if (!result || typeof result !== "string") {
          reject(new Error("Gagal membaca file"));
          return;
        }
        const base64 = result.split(",")[1];
        const key =
          "ktp_" + Date.now() + "_" + Math.random().toString(36).slice(2);
        const body = new URLSearchParams({
          action: "uploadKTP",
          fileName: namaFile,
          base64: base64,
          mimeType: file.type,
          key: key,
        });

        await fetch(SCRIPT_URL, {
          method: "POST",
          mode: "no-cors",
          body: body,
        });

        let attempts = 0;
        const poll = async (): Promise<void> => {
          attempts++;
          if (attempts > 30) {
            reject(new Error("Upload timeout. Coba lagi."));
            return;
          }
          try {
            const res: UploadResult = await callScript({
              action: "getUploadResult",
              key,
            });
            if (res.success && res.done) {
              resolve(res);
              return;
            }
            if (res.success === false && res.done) {
              reject(new Error(res.message));
              return;
            }
          } catch {}
          setTimeout(poll, 1500);
        };
        setTimeout(poll, 2000);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("Gagal membaca file"));
    reader.readAsDataURL(file);
  });
}

// ── Kompresi gambar ke maks 100 KB ───────────────────────
function compressImage(file: File, maxKB = 100): Promise<File> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxBytes = maxKB * 1024;
      const canvas = document.createElement("canvas");

      let { width, height } = img;
      const maxDim = 1200;
      if (width > maxDim || height > maxDim) {
        const ratio = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Gagal mengompresi gambar"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      let quality = 0.85;
      const tryCompress = () => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Gagal mengompresi gambar"));
              return;
            }
            if (blob.size <= maxBytes || quality <= 0.1) {
              const ext = file.type === "image/png" ? "png" : "jpg";
              const name =
                file.name.replace(/\.[^.]+$/, "") + "_compressed." + ext;
              resolve(new File([blob], name, { type: blob.type }));
            } else {
              quality = Math.max(0.1, quality - 0.1);
              tryCompress();
            }
          },
          file.type === "image/png" ? "image/jpeg" : file.type,
          quality
        );
      };
      tryCompress();
    };
    img.onerror = () => reject(new Error("Gagal memuat gambar"));
    img.src = url;
  });
}

const EMPTY_FORM: FormData = {
  nama: "",
  kamar: "",
  tanggal: "",
  ktp: "",
  ktpFileId: "",
  ktpUrl: "",
  biaya: "",
  barang: "",
  bulan: "",
};

function fmt(n: number | string): string {
  return "Rp " + Number(n).toLocaleString("id-ID");
}

function fmtDate(d: string): string {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

function hitungJatuhTempo(tanggal: string, bulan: string | number): string {
  if (!tanggal || !bulan) return "-";
  const d = new Date(tanggal);
  if (isNaN(d.getTime())) return "-";
  d.setMonth(d.getMonth() + Number(bulan));
  return fmtDate(d.toISOString().slice(0, 10));
}

function warnaJatuhTempo(tanggal: string, bulan: string | number): string {
  if (!tanggal || !bulan) return "#aaa";
  const jt = new Date(tanggal);
  if (isNaN(jt.getTime())) return "#aaa";
  jt.setMonth(jt.getMonth() + Number(bulan));
  const selisih = (jt.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24);
  if (selisih < 0) return "#A32D2D";
  if (selisih <= 14) return "#B45309";
  return "#0F6E56";
}

export default function KostApp() {
  const [data, setData] = useState<Penghuni[]>([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [editRow, setEditRow] = useState<Penghuni | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [ktpFile, setKtpFile] = useState<File | null>(null);
  const [ktpPreview, setKtpPreview] = useState("");
  const [ktpStatus, setKtpStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function fetchData() {
    setLoading(true);
    setError("");
    try {
      const json = await callScript({ action: "getAll" });
      if (json.success) setData(json.data);
      else setError(json.message || "Gagal memuat data");
    } catch {
      setError("Tidak dapat terhubung. Pastikan SCRIPT_URL sudah benar.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  const stats = useMemo(() => {
    const kamar = new Set(data.map((r) => r.kamar)).size;
    const total = data.reduce((s, r) => s + (Number(r.biaya) || 0), 0);
    return { jumlah: data.length, kamar, total };
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return data.filter(
      (r) =>
        r.nama.toLowerCase().includes(q) || r.kamar.toLowerCase().includes(q)
    );
  }, [data, search]);

  function openAdd() {
    setEditRow(null);
    setForm(EMPTY_FORM);
    resetKtp();
    setModal(true);
  }

  function openEdit(r: Penghuni) {
    setEditRow(r);
    setForm({
      nama: r.nama || "",
      kamar: r.kamar || "",
      tanggal: r.tanggal || "",
      ktp: r.ktp || "",
      ktpFileId: r.ktpFileId || "",
      ktpUrl: r.ktpUrl || "",
      biaya: r.biaya ? String(r.biaya) : "",
      barang: r.barang || "",
      bulan: r.bulan ? String(r.bulan) : "",
    });
    resetKtp();
    setModal(true);
  }

  function closeModal() {
    setModal(false);
    setEditRow(null);
    setForm(EMPTY_FORM);
    resetKtp();
  }

  function resetKtp() {
    setKtpFile(null);
    setKtpPreview("");
    setKtpStatus("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function notify(msg: string) {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 4000);
  }

  async function handleKtpChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/jpg", "image/png"].includes(file.type)) {
      setError("Hanya file JPG atau PNG yang diizinkan!");
      return;
    }
    const maxKB = 100;
    setKtpStatus("Memproses...");
    try {
      let finalFile = file;
      if (file.size > maxKB * 1024) {
        setKtpStatus(
          `Mengompresi (${(file.size / 1024).toFixed(
            0
          )} KB → maks ${maxKB} KB)...`
        );
        finalFile = await compressImage(file, maxKB);
        setKtpStatus(
          `✓ Dikompres: ${(file.size / 1024).toFixed(0)} KB → ${(
            finalFile.size / 1024
          ).toFixed(0)} KB`
        );
      } else {
        setKtpStatus(`✓ Siap upload: ${(file.size / 1024).toFixed(0)} KB`);
      }
      setKtpFile(finalFile);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result;
        if (result && typeof result === "string") setKtpPreview(result);
      };
      reader.readAsDataURL(finalFile);
    } catch (err) {
      setError(
        "Gagal memproses gambar: " +
          (err instanceof Error ? err.message : String(err))
      );
      setKtpStatus("");
    }
  }

  async function handleSave() {
    if (!form.nama.trim() || !form.kamar.trim()) {
      setError("Nama dan Kamar wajib diisi!");
      return;
    }
    setLoading(true);
    setError("");
    try {
      let ktpFileName = form.ktp;
      let ktpFileId = form.ktpFileId;

      if (ktpFile) {
        setUploading(true);
        setKtpStatus("Mengupload ke Google Drive...");
        try {
          const res = await uploadKTP(ktpFile, ktpFile.name);
          ktpFileName = res.fileName || "";
          ktpFileId = res.fileId || "";
          setKtpStatus("✓ Upload berhasil!");
        } catch (err) {
          setError(
            "Upload KTP gagal: " +
              (err instanceof Error ? err.message : String(err))
          );
          setLoading(false);
          setUploading(false);
          return;
        } finally {
          setUploading(false);
        }
      }

      const params = editRow
        ? {
            action: "update",
            rowIndex: editRow.rowIndex,
            ...form,
            ktp: ktpFileName,
            ktpFileId,
          }
        : { action: "add", ...form, ktp: ktpFileName, ktpFileId };

      const json = await callScript(params);
      if (json.success) {
        notify(
          editRow
            ? "Data berhasil diperbarui!"
            : "Penghuni berhasil ditambahkan!"
        );
        closeModal();
        fetchData();
      } else {
        setError(json.message || "Gagal menyimpan data");
      }
    } catch {
      setError("Koneksi gagal.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(row: Penghuni) {
    if (!window.confirm(`Hapus data "${row.nama}"?`)) return;
    setLoading(true);
    try {
      const json = await callScript({
        action: "delete",
        rowIndex: row.rowIndex,
      });
      if (json.success) {
        notify("Data berhasil dihapus!");
        fetchData();
      } else setError(json.message || "Gagal menghapus");
    } catch {
      setError("Koneksi gagal.");
    } finally {
      setLoading(false);
    }
  }

  function exportCSV() {
    const headers = [
      "Nama Penghuni",
      "Kamar",
      "Tanggal Masuk",
      "File KTP",
      "Link KTP",
      "Biaya Kost",
      "Barang Penghuni",
      "Untuk Berapa Bulan",
      "Jatuh Tempo",
    ];
    const rows = data.map((r) => [
      r.nama,
      r.kamar,
      r.tanggal,
      r.ktp,
      r.ktpUrl ||
        (r.ktpFileId
          ? `https://drive.google.com/file/d/${r.ktpFileId}/view`
          : ""),
      r.biaya,
      r.barang,
      r.bulan,
      hitungJatuhTempo(r.tanggal, r.bulan),
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${c}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv;charset=utf-8,\uFEFF" + encodeURIComponent(csv);
    a.download = "data_penghuni_kost.csv";
    a.click();
  }

  // Field input definitions
  const fieldDefs: {
    key: keyof FormData;
    label: string;
    type: string;
    placeholder: string;
  }[] = [
    {
      key: "nama",
      label: "Nama Penghuni *",
      type: "text",
      placeholder: "Nama lengkap",
    },
    {
      key: "kamar",
      label: "Nomor Kamar *",
      type: "text",
      placeholder: "Mis: A01",
    },
    { key: "tanggal", label: "Tanggal Masuk", type: "date", placeholder: "" },
    {
      key: "biaya",
      label: "Biaya Kost (Rp)",
      type: "number",
      placeholder: "1500000",
    },
    {
      key: "bulan",
      label: "Untuk Berapa Bulan",
      type: "number",
      placeholder: "3",
    },
  ];

  // ════════════════════════════════════════════════════════
  return (
    <div style={S.container}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.headerIcon}>🏠</div>
        <div>
          <h1 style={S.h1}>Manajemen Penghuni Kost</h1>
          <p style={S.subtitle}>Kelola data penghuni, kamar, dan pembayaran</p>
        </div>
        <button
          style={{ ...S.btn, ...S.btnPrimary, marginLeft: "auto" }}
          onClick={openAdd}
        >
          + Tambah Penghuni
        </button>
      </div>

      {error && (
        <div style={S.alertError}>
          ⚠ {error}
          <button style={S.closeAlert} onClick={() => setError("")}>
            ✕
          </button>
        </div>
      )}
      {success && <div style={S.alertSuccess}>✓ {success}</div>}

      {/* Stats */}
      <div style={S.statsGrid}>
        <div style={S.stat}>
          <div style={S.statLabel}>Total Penghuni</div>
          <div style={S.statValue}>{stats.jumlah}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Kamar Terisi</div>
          <div style={{ ...S.statValue, color: "#0F6E56" }}>{stats.kamar}</div>
        </div>
        <div style={S.stat}>
          <div style={S.statLabel}>Total Pendapatan/bln</div>
          <div style={S.statValue}>{fmt(stats.total)}</div>
        </div>
      </div>

      {/* Tabel */}
      <div style={S.card}>
        <div style={S.searchRow}>
          <input
            style={{ ...S.input, flex: 1 }}
            placeholder="Cari nama atau nomor kamar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button style={S.btn} onClick={fetchData} disabled={loading}>
            {loading ? "⏳" : "↻ Refresh"}
          </button>
          <button style={S.btn} onClick={exportCSV}>
            ↓ Export CSV
          </button>
        </div>
        {loading && (
          <p style={{ color: "#888", textAlign: "center", padding: "1rem" }}>
            Memuat data...
          </p>
        )}
        <div style={{ overflowX: "auto" }}>
          <table style={S.table}>
            <thead>
              <tr>
                {[
                  "Nama Penghuni",
                  "Kamar",
                  "Tanggal Masuk",
                  "File KTP",
                  "Biaya Kost",
                  "Barang Penghuni",
                  "Bulan",
                  "Jatuh Tempo",
                  "Aksi",
                ].map((h) => (
                  <th key={h} style={S.th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    style={{
                      textAlign: "center",
                      padding: "2rem",
                      color: "#888",
                    }}
                  >
                    Tidak ada data penghuni
                  </td>
                </tr>
              ) : (
                filtered.map((row, i) => (
                  <tr key={i}>
                    <td style={S.td}>{row.nama}</td>
                    <td style={S.td}>
                      <span style={S.badge}>{row.kamar}</span>
                    </td>
                    <td style={S.td}>{fmtDate(row.tanggal)}</td>
                    <td style={S.td}>
                      {row.ktpUrl ? (
                        <a
                          href={row.ktpUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#0F6E56", fontSize: 12 }}
                        >
                          🖼 {row.ktp || "Lihat KTP"}
                        </a>
                      ) : (
                        <span style={{ color: "#aaa", fontSize: 12 }}>
                          {row.ktp || "-"}
                        </span>
                      )}
                    </td>
                    <td style={S.td}>{row.biaya ? fmt(row.biaya) : "-"}</td>
                    <td
                      style={{
                        ...S.td,
                        maxWidth: 140,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {row.barang || "-"}
                    </td>
                    <td style={S.td}>{row.bulan || "-"}</td>
                    <td
                      style={{
                        ...S.td,
                        color: warnaJatuhTempo(row.tanggal, row.bulan),
                        fontWeight: 500,
                      }}
                    >
                      {hitungJatuhTempo(row.tanggal, row.bulan)}
                    </td>
                    <td style={S.td}>
                      <button
                        style={{
                          ...S.btn,
                          padding: "4px 10px",
                          fontSize: 12,
                          marginRight: 4,
                        }}
                        onClick={() => openEdit(row)}
                      >
                        Edit
                      </button>
                      <button
                        style={{
                          ...S.btn,
                          padding: "4px 10px",
                          fontSize: 12,
                          color: "#A32D2D",
                        }}
                        onClick={() => handleDelete(row)}
                      >
                        Hapus
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <div
          style={S.modalBg}
          onClick={(e) => e.target === e.currentTarget && closeModal()}
        >
          <div style={S.modal}>
            <h2 style={{ fontSize: 16, fontWeight: 500, marginBottom: "1rem" }}>
              {editRow ? "Edit Data Penghuni" : "Tambah Penghuni Baru"}
            </h2>
            <div style={S.formGrid}>
              {fieldDefs.map(({ key, label, type, placeholder }) => (
                <div
                  key={key}
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <label style={S.label}>{label}</label>
                  <input
                    style={S.input}
                    type={type}
                    placeholder={placeholder}
                    value={form[key]}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [key]: e.target.value }))
                    }
                  />
                </div>
              ))}

              {/* Upload KTP — full width */}
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <label style={S.label}>
                  Foto KTP (JPG / PNG, maks 100 KB setelah kompresi)
                </label>
                <div
                  style={S.uploadBox}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {ktpPreview ? (
                    <img
                      src={ktpPreview}
                      alt="Preview KTP"
                      style={{
                        maxHeight: 120,
                        maxWidth: "100%",
                        borderRadius: 6,
                        objectFit: "contain",
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        textAlign: "center",
                        color: "#999",
                        padding: "1rem 0",
                      }}
                    >
                      <div style={{ fontSize: 28, marginBottom: 4 }}>📷</div>
                      <div style={{ fontSize: 13 }}>
                        Klik untuk pilih foto KTP
                      </div>
                      <div style={{ fontSize: 11, marginTop: 2 }}>
                        JPG atau PNG
                      </div>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/jpg,image/png"
                    style={{ display: "none" }}
                    onChange={handleKtpChange}
                  />
                </div>
                {ktpStatus && (
                  <div
                    style={{
                      fontSize: 12,
                      color: ktpStatus.startsWith("✓") ? "#0F6E56" : "#888",
                      background: ktpStatus.startsWith("✓")
                        ? "#E1F5EE"
                        : "#f5f5f3",
                      padding: "5px 10px",
                      borderRadius: 6,
                    }}
                  >
                    {ktpStatus}
                  </div>
                )}
                {!ktpFile && form.ktp && (
                  <div style={{ fontSize: 12, color: "#555" }}>
                    File saat ini:{" "}
                    <a
                      href={
                        form.ktpUrl ||
                        (form.ktpFileId
                          ? `https://drive.google.com/file/d/${form.ktpFileId}/view`
                          : "#")
                      }
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "#0F6E56" }}
                    >
                      🖼 {form.ktp}
                    </a>
                    <span style={{ color: "#aaa", marginLeft: 6 }}>
                      (biarkan kosong untuk mempertahankan)
                    </span>
                  </div>
                )}
              </div>

              {/* Barang — full width */}
              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <label style={S.label}>Barang Penghuni</label>
                <input
                  style={S.input}
                  type="text"
                  placeholder="Lemari, Kasur, Motor, ..."
                  value={form.barang}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, barang: e.target.value }))
                  }
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: "1rem",
                alignItems: "center",
              }}
            >
              <button
                style={{
                  ...S.btn,
                  ...S.btnPrimary,
                  opacity: loading || uploading ? 0.7 : 1,
                }}
                onClick={handleSave}
                disabled={loading || uploading}
              >
                {uploading
                  ? "⏳ Mengupload KTP..."
                  : loading
                  ? "Menyimpan..."
                  : "Simpan"}
              </button>
              <button
                style={S.btn}
                onClick={closeModal}
                disabled={loading || uploading}
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S: Record<string, CSSProperties> = {
  container: {
    maxWidth: 1060,
    margin: "0 auto",
    padding: "1.5rem 1rem",
    fontFamily: "sans-serif",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: "1.5rem",
  },
  headerIcon: {
    width: 44,
    height: 44,
    background: "#1D9E75",
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 22,
  },
  h1: { fontSize: 20, fontWeight: 500, margin: 0 },
  subtitle: { fontSize: 13, color: "#666", margin: 0 },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3,1fr)",
    gap: 10,
    marginBottom: "1.5rem",
  },
  stat: { background: "#f5f5f3", borderRadius: 8, padding: "14px 16px" },
  statLabel: { fontSize: 12, color: "#888", marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: 500 },
  card: {
    background: "#fff",
    border: "0.5px solid #ddd",
    borderRadius: 12,
    padding: "1.25rem",
    marginBottom: "1rem",
  },
  searchRow: { display: "flex", gap: 8, marginBottom: "1rem" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: {
    textAlign: "left",
    padding: "8px 10px",
    fontWeight: 500,
    color: "#555",
    fontSize: 12,
    borderBottom: "0.5px solid #eee",
    background: "#f9f9f7",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 10px",
    borderBottom: "0.5px solid #f0f0f0",
    whiteSpace: "nowrap",
  },
  badge: {
    background: "#E1F5EE",
    color: "#0F6E56",
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 99,
  },
  btn: {
    padding: "8px 14px",
    border: "0.5px solid #ccc",
    borderRadius: 8,
    background: "#fff",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "sans-serif",
  },
  btnPrimary: { background: "#1D9E75", color: "#fff", borderColor: "#1D9E75" },
  input: {
    padding: "8px 10px",
    border: "0.5px solid #ccc",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "sans-serif",
    width: "100%",
  },
  label: { fontSize: 13, color: "#666" },
  alertError: {
    background: "#FCEBEB",
    color: "#A32D2D",
    padding: "10px 14px",
    borderRadius: 8,
    marginBottom: "1rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 14,
  },
  alertSuccess: {
    background: "#E1F5EE",
    color: "#0F6E56",
    padding: "10px 14px",
    borderRadius: 8,
    marginBottom: "1rem",
    fontSize: 14,
  },
  closeAlert: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "#A32D2D",
    fontSize: 16,
  },
  modalBg: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modal: {
    background: "#fff",
    borderRadius: 12,
    border: "0.5px solid #ddd",
    padding: "1.5rem",
    width: "100%",
    maxWidth: 520,
    maxHeight: "90vh",
    overflowY: "auto",
  },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  uploadBox: {
    border: "1.5px dashed #ccc",
    borderRadius: 8,
    padding: "10px",
    cursor: "pointer",
    minHeight: 80,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#fafafa",
    transition: "border-color 0.2s",
  },
};
