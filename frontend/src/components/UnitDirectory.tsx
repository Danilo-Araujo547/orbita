import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { query, request } from "../api";
import type { Paginated, Unit } from "../types";
import FormAction from "./FormAction";
import { Building2, Trash2, Upload } from "lucide-react";

type UnitRow = Unit & { timezone: string; version: number };

function processImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.type === "image/svg+xml") {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 512;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(String(reader.result || ""));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/webp", 0.92));
      };
      img.onerror = () => resolve(String(reader.result || ""));
      img.src = String(reader.result || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function UnitLogoUploader({
  initialLogo = "",
  unitName = "",
}: {
  initialLogo?: string;
  unitName?: string;
}) {
  const [logo, setLogo] = useState(initialLogo);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setUploadError("Por favor, selecione um arquivo de imagem válido (PNG, JPG, SVG, WEBP).");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("O arquivo de imagem excede o limite máximo de 5 MB.");
      return;
    }
    setUploadError("");
    try {
      const dataUrl = await processImage(file);
      setLogo(dataUrl);
    } catch {
      setUploadError("Não foi possível carregar a imagem selecionada.");
    }
  };

  const clearLogo = () => {
    setLogo("");
    setUploadError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="unit-logo-uploader-card">
      <input type="hidden" name="logo" value={logo} />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
      <div className="unit-logo-preview-row">
        <div
          className={`unit-logo-majestic-avatar ${dragOver ? "drag-over" : ""} ${logo ? "has-image" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.[0]) void handleFile(e.dataTransfer.files[0]);
          }}
          title="Clique ou arraste uma imagem para carregar a logo"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
        >
          {logo ? (
            <img src={logo} alt={unitName ? `Logo de ${unitName}` : "Logo"} className="unit-logo-preview-img" />
          ) : (
            <div className="unit-logo-placeholder">
              <Building2 size={26} className="unit-placeholder-icon" />
              <span className="unit-placeholder-text">Logo</span>
            </div>
          )}
          <div className="unit-logo-hover-badge">
            <Upload size={14} />
          </div>
        </div>

        <div className="unit-logo-info">
          <div className="unit-logo-info-title">
            <span>Identidade Visual da Unidade</span>
            {logo && <span className="unit-logo-active-tag">Logo ativa</span>}
          </div>
          <div className="unit-logo-info-hint">
            Exibida com destaque na barra lateral, seletor de unidades e listagens.
          </div>
          <div className="unit-logo-btn-row">
            <button
              type="button"
              className="button unit-logo-action-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={13} />
              <span>{logo ? "Alterar logo" : "Carregar logo"}</span>
            </button>
            {logo && (
              <button
                type="button"
                className="button unit-logo-remove-btn"
                onClick={clearLogo}
                title="Remover logo personalizada e voltar ao ícone padrão"
              >
                <Trash2 size={13} />
                <span>Remover</span>
              </button>
            )}
          </div>
        </div>
      </div>
      {uploadError && (
        <p className="inline-error" style={{ margin: "8px 0 0" }}>
          {uploadError}
        </p>
      )}
    </div>
  );
}

export default function UnitDirectory({
  unit,
  editable = true,
  onChanged,
}: {
  unit: string;
  editable?: boolean;
  onChanged?: () => Promise<void>;
}) {
  const [rows, setRows] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    async function load() {
      const found: UnitRow[] = [];
      let page = 1;
      while (true) {
        const result = await request<Paginated<UnitRow>>(
          query("units", { unit, page: String(page) }),
        );
        found.push(...result.results);
        if (!result.next) break;
        page++;
      }
      if (active) setRows(found);
    }
    load()
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [unit, revision]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError("");
    try {
      await request(query("units", { unit }), "POST", values);
      setRevision((v) => v + 1);
      if (onChanged) await onChanged();
      else window.location.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function configure(event: FormEvent<HTMLFormElement>, row: UnitRow) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await request(query(`units/${row.id}/configure`, { unit }), "POST", {
        version: row.version,
        name: values.get("name"),
        timezone: values.get("timezone"),
        response_hours: Number(values.get("response_hours")),
        paused: values.get("paused") === "on",
        authorized_recipients: String(values.get("authorized_recipients") || "")
          .split(/[\s,;]+/)
          .filter(Boolean),
        logo: String(values.get("logo") || ""),
      });
      setRevision((v) => v + 1);
      await onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="unit-directory">
      <div className="unit-toolbar">
        <div className="unit-summary">
          <span className="unit-count">
            {loading
              ? "Carregando…"
              : `${rows.length} ${rows.length === 1 ? "unidade cadastrada" : "unidades cadastradas"}`}
          </span>
        </div>
        {editable && (
          <div className="unit-toolbar-actions">
            <FormAction
              title="Nova unidade"
              label="Adicionar unidade"
              version={revision}
              busy={busy}
              error={error}
            >
              <form className="op-form unit-form" onSubmit={create}>
                <UnitLogoUploader unitName="Nova Unidade" />

                <div className="unit-form-grid">
                  <label className="op-field unit-field-full">
                    <span>Nome</span>
                    <input
                      name="name"
                      required
                      maxLength={150}
                      autoComplete="off"
                      placeholder="Ex.: Unidade Central"
                    />
                  </label>
                  <label className="op-field">
                    <span>Identificador</span>
                    <input
                      name="slug"
                      required
                      maxLength={50}
                      pattern="[a-z0-9-]+"
                      autoComplete="off"
                      placeholder="ex.: central"
                    />
                  </label>
                  <label className="op-field">
                    <span>Fuso horário</span>
                    <input
                      name="timezone"
                      required
                      defaultValue="America/Sao_Paulo"
                      placeholder="Ex.: America/Sao_Paulo"
                    />
                  </label>
                </div>
                <button type="submit" className="button primary">
                  Criar unidade
                </button>
              </form>
            </FormAction>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}

      {loading ? (
        <p className="directory-empty" role="status">
          Carregando unidades…
        </p>
      ) : (
        <div className="table-scroll">
          <table className="directory-table">
            <thead>
              <tr>
                <th className="unit-col-name">Unidade</th>
                <th className="unit-col-slug">Identificador</th>
                <th className="unit-col-timezone">Fuso horário</th>
                <th className="unit-col-status">Envios</th>
                <th className="unit-col-actions">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.slug}>
                  <td className="unit-col-name">
                    <div className="unit-name-cell">
                      {row.logo ? (
                        <span className="unit-table-logo-badge" title={`Logo de ${row.name}`}>
                          <img src={row.logo} alt="" className="unit-logo-img" />
                        </span>
                      ) : (
                        <span className="unit-table-icon-fallback" aria-hidden="true">
                          <Building2 size={16} />
                        </span>
                      )}
                      <div className="unit-name-info">
                        <strong>{row.name}</strong>
                        {row.slug === unit && (
                          <span className="directory-current">Atual</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="unit-col-slug">
                    <span className="directory-code">{row.slug}</span>
                  </td>
                  <td className="unit-col-timezone">{row.timezone}</td>
                  <td className="unit-col-status">
                    <span
                      className={`directory-status ${row.paused ? "paused" : "active"}`}
                    >
                      {row.paused ? "Pausados" : "Ativos"}
                    </span>
                  </td>
                  <td className="unit-col-actions">
                    {editable && (
                      <FormAction
                        title={`Editar ${row.name}`}
                        label="Editar"
                        version={revision}
                        busy={busy}
                        error={error}
                      >
                        <form
                          className="op-form unit-form"
                          onSubmit={(e) => void configure(e, row)}
                        >
                          <UnitLogoUploader initialLogo={row.logo || ""} unitName={row.name} />

                          <div className="unit-form-grid">
                            <label className="op-field unit-field-full">
                              <span>Nome</span>
                              <input
                                name="name"
                                required
                                maxLength={150}
                                defaultValue={row.name}
                              />
                            </label>
                            <label className="op-field">
                              <span>Fuso horário</span>
                              <input
                                name="timezone"
                                required
                                defaultValue={row.timezone}
                              />
                            </label>
                            <label className="op-field">
                              <span>Prazo de resposta (horas)</span>
                              <input
                                name="response_hours"
                                type="number"
                                required
                                min={1}
                                max={168}
                                defaultValue={row.response_hours}
                              />
                            </label>
                          </div>
                          <label className="checkbox-label unit-checkbox-label">
                            <input
                              name="paused"
                              type="checkbox"
                              defaultChecked={row.paused}
                            />
                            <span>Envios pausados</span>
                          </label>
                          <label className="op-field unit-field-full">
                            <span>Destinatários autorizados para teste</span>
                            <textarea
                              name="authorized_recipients"
                              defaultValue={
                                row.effective_recipients?.join("\n") || ""
                              }
                              rows={4}
                              placeholder="Insira um destinatário por linha ou separados por vírgula"
                            />
                          </label>
                          <button
                            type="submit"
                            className="button primary"
                            disabled={busy}
                          >
                            Salvar unidade
                          </button>
                        </form>
                      </FormAction>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && (
            <p className="directory-empty">Nenhuma unidade cadastrada.</p>
          )}
        </div>
      )}
    </div>
  );
}
