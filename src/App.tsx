import { useEffect, useRef, useState } from "react";
import "./styles.css";
import type { Layer, Specimen, Store } from "./types";
import type { Action, AppEvent } from "./lib/store";
import { applyAction, fmtCoord, fmtDepth, loadStore, persistStore } from "./lib/store";

const roles = ["发掘队员", "领队", "资料整理员"];
const STATUS_COLORS = ["status-ok", "status-watch", "status-danger"];

function MetricCard({ label, value, index }: { label: string; value: string; index: number }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={STATUS_COLORS[index % STATUS_COLORS.length]} />
    </article>
  );
}

function CorrectModal({
  specimen,
  layer,
  onClose,
  onSubmit,
}: {
  specimen: Specimen;
  layer: Layer | undefined;
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    e: number;
    n: number;
    depth: number;
    count: number;
    reason: string;
  }) => void;
}) {
  const [name, setName] = useState(specimen.name);
  const [e, setE] = useState(String(specimen.coord.e));
  const [n, setN] = useState(String(specimen.coord.n));
  const [depth, setDepth] = useState(String(specimen.coord.depth));
  const [count, setCount] = useState(String(specimen.count));
  const [reason, setReason] = useState("");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()}>
        <h3>更正标本 {specimen.specimenNo}</h3>
        <p className="modal-sub">
          所属地层：{layer?.name ?? "未知"} · 层位{" "}
          {layer ? `${fmtDepth(layer.topDepth)}–${fmtDepth(layer.bottomDepth)}` : "—"}
        </p>
        {specimen.frozen && (
          <p className="frozen-note">
            该标本已移交冻结，坐标与件数不可直接改动；提交后将生成一条带原因的修订记录，原值保留在修订链中。
          </p>
        )}
        <form
          className="modal-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            onSubmit({
              name: name.trim(),
              e: Number(e),
              n: Number(n),
              depth: Number(depth),
              count: Number(count),
              reason: reason.trim(),
            });
          }}
        >
          <label>
            <span>名称</span>
            <input value={name} onChange={(ev) => setName(ev.target.value)} required />
          </label>
          <div className="row">
            <label>
              <span>坐标 E</span>
              <input type="number" step="0.01" value={e} onChange={(ev) => setE(ev.target.value)} required />
            </label>
            <label>
              <span>坐标 N</span>
              <input type="number" step="0.01" value={n} onChange={(ev) => setN(ev.target.value)} required />
            </label>
            <label>
              <span>深度（米）</span>
              <input type="number" step="0.01" min="0" value={depth} onChange={(ev) => setDepth(ev.target.value)} required />
            </label>
          </div>
          <label>
            <span>件数</span>
            <input type="number" step="1" min="1" value={count} onChange={(ev) => setCount(ev.target.value)} required />
          </label>
          <label>
            <span>
              修订原因{specimen.frozen ? "（必填，随修订链永久保留）" : "（未移交标本可直接更正，无需填写）"}
            </span>
            <textarea
              value={reason}
              onChange={(ev) => setReason(ev.target.value)}
              required={specimen.frozen}
              placeholder="如：移交清点时漏记 1 件"
            />
          </label>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="primary-action">
              {specimen.frozen ? "生成修订并更正" : "直接更正"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function App() {
  const [store, setStore] = useState<Store>(loadStore);
  const [event, setEvent] = useState<AppEvent | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [revisionSpecimenId, setRevisionSpecimenId] = useState<string | null>(null);
  const [layerFilter, setLayerFilter] = useState<string>("all");
  const fileRef = useRef<HTMLInputElement>(null);

  // 每次变更即落盘，刷新后探方、地层、出土物与修订链保持一致
  useEffect(() => {
    persistStore(store);
  }, [store]);

  function act(action: Action): AppEvent | null {
    const res = applyAction(store, action);
    if (res.event) setEvent(res.event);
    if (res.store !== store) setStore(res.store);
    return res.event;
  }

  const trench =
    store.trenches.find((t) => t.id === store.selectedTrenchId) ?? store.trenches[0] ?? null;
  const trenchLayers = trench
    ? store.layers.filter((l) => l.trenchId === trench.id).sort((a, b) => a.topDepth - b.topDepth)
    : [];
  const trenchSpecimens = trench ? store.specimens.filter((s) => s.trenchId === trench.id) : [];
  const trenchPieces = trenchSpecimens.reduce((m, s) => m + s.count, 0);
  const nextTop = trenchLayers.reduce((m, l) => Math.max(m, l.bottomDepth), 0);
  const layerById = new Map(store.layers.map((l) => [l.id, l]));
  const revCountBySpecimen = new Map<string, number>();
  for (const r of store.revisions) {
    revCountBySpecimen.set(r.specimenId, (revCountBySpecimen.get(r.specimenId) ?? 0) + 1);
  }
  const filteredSpecimens = (
    layerFilter === "all"
      ? trenchSpecimens
      : trenchSpecimens.filter((s) => s.layerId === layerFilter)
  )
    .slice()
    .sort((a, b) => a.specimenNo.localeCompare(b.specimenNo));

  const totalPieces = store.specimens.reduce((m, s) => m + s.count, 0);
  const openLayers = store.layers.filter((l) => !l.closed).length;

  const correcting = store.specimens.find((s) => s.id === correctingId) ?? null;
  const revisionSpecimen =
    store.specimens.find((s) => s.id === revisionSpecimenId) ??
    store.specimens.find((s) => revCountBySpecimen.has(s.id)) ??
    null;
  const specimenRevisions = revisionSpecimen
    ? store.revisions.filter((r) => r.specimenId === revisionSpecimen.id)
    : [];

  function submitTrench(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const ev = act({
      type: "add-trench",
      name: String(fd.get("name") ?? ""),
      depth: Number(fd.get("depth")),
    });
    if (ev?.kind === "ok") form.reset();
  }

  function submitLayer(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!trench) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const ev = act({
      type: "add-layer",
      trenchId: trench.id,
      name: String(fd.get("name") ?? ""),
      soilColor: String(fd.get("soil") ?? ""),
      bottomDepth: Number(fd.get("bottom")),
    });
    if (ev?.kind === "ok") form.reset();
  }

  function submitArtifact(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!trench) return;
    const form = e.currentTarget;
    const fd = new FormData(form);
    const ev = act({
      type: "register-artifact",
      trenchId: trench.id,
      layerId: String(fd.get("layerId") ?? ""),
      name: String(fd.get("name") ?? ""),
      coord: { e: Number(fd.get("e")), n: Number(fd.get("n")), depth: Number(fd.get("depth")) },
      count: Number(fd.get("count")),
      specimenNo: String(fd.get("specimenNo") ?? ""),
    });
    if (ev?.kind === "ok") form.reset();
  }

  function exportArchive() {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hxwl-10-archive-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    file
      .text()
      .then((text) => {
        try {
          const data = JSON.parse(text) as Store;
          const valid =
            data &&
            data.version === 1 &&
            Array.isArray(data.trenches) &&
            Array.isArray(data.layers) &&
            Array.isArray(data.specimens) &&
            Array.isArray(data.revisions);
          if (!valid) {
            setEvent({ kind: "conflict", text: "导入失败：档案格式不符" });
            return;
          }
          const normalized: Store = {
            version: 1,
            trenches: data.trenches,
            layers: data.layers,
            specimens: data.specimens,
            revisions: data.revisions,
            conflicts: Array.isArray(data.conflicts) ? data.conflicts : [],
            selectedTrenchId: data.trenches.some((t) => t.id === data.selectedTrenchId)
              ? data.selectedTrenchId
              : data.trenches[0]?.id ?? null,
          };
          act({ type: "import-store", store: normalized });
        } catch {
          setEvent({ kind: "conflict", text: "导入失败：不是有效的 JSON 档案" });
        }
      })
      .catch(() => setEvent({ kind: "conflict", text: "导入失败：无法读取文件" }));
  }

  function resetArchive() {
    if (window.confirm("确定要清空当前档案并恢复示例数据吗？")) {
      act({ type: "reset" });
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-10 · 本地落盘档案 · port 5110</p>
          <h1>考古探方记录</h1>
          <p className="subtitle">
            探方—地层—出土物坐标闭环：新地层顶深自动承接上层层底且不超出探方深度；同一探方内坐标重复的出土物归并到同一标本编号；未闭合地层不得登记出土物；移交即冻结坐标与件数，更正只能以带原因的修订保留原值。
          </p>
        </div>
        <div className="stack-card">
          <span>档案操作（每次变更即落盘，刷新后数据一致）</span>
          <strong>React + Vite + TypeScript · localStorage 持久化</strong>
          <div className="hero-actions">
            <button onClick={exportArchive}>导出档案</button>
            <button onClick={() => fileRef.current?.click()}>导入档案</button>
            <button onClick={resetArchive}>重置示例</button>
          </div>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImportFile} />
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="探方数" value={String(store.trenches.length)} index={0} />
        <MetricCard label="地层数" value={String(store.layers.length)} index={1} />
        <MetricCard label="出土物（件）" value={String(totalPieces)} index={2} />
        <MetricCard label="未闭合地层" value={String(openLayers)} index={3} />
      </section>

      {event && (
        <div className={`event-banner ${event.kind}`} role="status">
          <span>
            {event.kind === "conflict" ? "冲突：" : "完成："}
            {event.text}
          </span>
          <button onClick={() => setEvent(null)}>知道了</button>
        </div>
      )}

      <section className="workspace">
        <aside className="panel narrow">
          <h2>探方（{store.trenches.length}）</h2>
          <div className="trench-list">
            {store.trenches.map((t) => {
              const ls = store.layers.filter((l) => l.trenchId === t.id);
              const ss = store.specimens.filter((s) => s.trenchId === t.id);
              const open = ls.filter((l) => !l.closed).length;
              return (
                <button
                  key={t.id}
                  className={"trench-item" + (trench?.id === t.id ? " active" : "")}
                  onClick={() => act({ type: "select-trench", trenchId: t.id })}
                >
                  <strong>{t.name}</strong>
                  <span>
                    深度 {fmtDepth(t.depth)} · 地层 {ls.length} · 标本 {ss.length}
                  </span>
                  {open > 0 && <em>{open} 层未闭合</em>}
                </button>
              );
            })}
          </div>
          <form className="stack-form" onSubmit={submitTrench}>
            <h3>新增探方</h3>
            <input name="name" required placeholder="探方编号，如 T0302" />
            <input name="depth" type="number" step="0.1" min="0.1" required placeholder="探方深度（米）" />
            <button className="primary-action" type="submit">
              建立探方
            </button>
          </form>
          <h2>角色</h2>
          <div className="chips">
            {roles.map((r) => (
              <span key={r}>{r}</span>
            ))}
          </div>
        </aside>

        <div className="center-col">
          {trench ? (
            <>
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <p>地层堆积 · 顶深自动承接上层层底</p>
                    <h2>
                      {trench.name} 地层（{trenchLayers.length}）
                    </h2>
                  </div>
                  <span className="depth-tag">探方深度 {fmtDepth(trench.depth)}</span>
                </div>
                {trenchLayers.length === 0 ? (
                  <p className="empty">尚无地层，请在下方登记第 1 层（顶深 0.00m）。</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>层名</th>
                          <th>顶深</th>
                          <th>底深</th>
                          <th>土色</th>
                          <th>状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trenchLayers.map((l) => (
                          <tr key={l.id}>
                            <td>
                              <strong>{l.name}</strong>
                            </td>
                            <td>{fmtDepth(l.topDepth)}</td>
                            <td>{fmtDepth(l.bottomDepth)}</td>
                            <td>{l.soilColor}</td>
                            <td>
                              {l.closed ? (
                                <span className="badge ok">已闭合</span>
                              ) : (
                                <span className="badge warn">未闭合</span>
                              )}
                            </td>
                            <td>
                              {l.closed ? (
                                <span className="muted-cell">可登记出土物</span>
                              ) : (
                                <button onClick={() => act({ type: "close-layer", layerId: l.id })}>
                                  闭合地层
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <form className="inline-form" onSubmit={submitLayer}>
                  <span className="auto-top">
                    新层顶深 <strong>{fmtDepth(nextTop)}</strong>
                    <br />
                    （承接上层底深）
                  </span>
                  <label>
                    <span>层名</span>
                    <input name="name" placeholder={`默认 第${trenchLayers.length + 1}层`} />
                  </label>
                  <label>
                    <span>土色</span>
                    <input name="soil" placeholder="如 灰褐土" />
                  </label>
                  <label>
                    <span>底深（≤ {fmtDepth(trench.depth)}）</span>
                    <input name="bottom" type="number" step="0.01" min="0" required placeholder="如 0.60" />
                  </label>
                  <button className="primary-action" type="submit">
                    登记地层
                  </button>
                </form>
              </section>

              <section className="panel">
                <div className="section-heading">
                  <div>
                    <p>出土物 · 同探方坐标唯一，重复坐标归并同一标本编号</p>
                    <h2>
                      {trench.name} 出土物（{trenchSpecimens.length} 个标本 / {trenchPieces} 件）
                    </h2>
                  </div>
                  <div className="row-actions">
                    <select value={layerFilter} onChange={(e) => setLayerFilter(e.target.value)}>
                      <option value="all">全部地层</option>
                      {trenchLayers.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <button onClick={() => act({ type: "handover-trench", trenchId: trench.id })}>
                      移交本探方全部
                    </button>
                  </div>
                </div>

                {trenchLayers.length === 0 ? (
                  <p className="empty">请先登记并闭合地层，才能登记出土物。</p>
                ) : (
                  <>
                    <form className="inline-form artifact-form" onSubmit={submitArtifact}>
                      <label>
                        <span>所属地层（未闭合将被拒绝）</span>
                        <select name="layerId" required defaultValue="">
                          <option value="" disabled>
                            选择地层
                          </option>
                          {trenchLayers.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}（{fmtDepth(l.topDepth)}–{fmtDepth(l.bottomDepth)}）
                              {l.closed ? "" : " · 未闭合"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>坐标 E</span>
                        <input name="e" type="number" step="0.01" required placeholder="如 3.00" />
                      </label>
                      <label>
                        <span>坐标 N</span>
                        <input name="n" type="number" step="0.01" required placeholder="如 4.00" />
                      </label>
                      <label>
                        <span>深度（米）</span>
                        <input name="depth" type="number" step="0.01" min="0" required placeholder="层位范围内" />
                      </label>
                      <label>
                        <span>名称</span>
                        <input name="name" required placeholder="如 陶片" />
                      </label>
                      <label>
                        <span>件数</span>
                        <input name="count" type="number" step="1" min="1" required placeholder="如 12" />
                      </label>
                      <label>
                        <span>标本编号</span>
                        <input name="specimenNo" placeholder="留空自动编号" />
                      </label>
                      <button className="primary-action" type="submit">
                        登记出土物
                      </button>
                    </form>
                    <p className="form-hint">
                      坐标（E/N/深度）在同一探方内唯一：重复坐标自动归并到原标本编号并累加件数；已移交冻结的标本拒绝归并，须走修订。
                    </p>
                  </>
                )}

                {filteredSpecimens.length === 0 ? (
                  <p className="empty">暂无出土物记录。</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>标本编号</th>
                          <th>名称</th>
                          <th>坐标</th>
                          <th>件数</th>
                          <th>地层</th>
                          <th>状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSpecimens.map((s) => {
                          const l = layerById.get(s.layerId);
                          const revCount = revCountBySpecimen.get(s.id) ?? 0;
                          return (
                            <tr key={s.id}>
                              <td>
                                <strong>{s.specimenNo}</strong>
                              </td>
                              <td>{s.name}</td>
                              <td>{fmtCoord(s.coord)}</td>
                              <td>{s.count}</td>
                              <td>{l?.name ?? "—"}</td>
                              <td>
                                {s.frozen ? (
                                  <span className="badge frozen">已移交冻结</span>
                                ) : (
                                  <span className="badge ok">在册</span>
                                )}
                              </td>
                              <td>
                                <div className="row-actions">
                                  {!s.frozen && (
                                    <button onClick={() => act({ type: "handover-specimen", specimenId: s.id })}>
                                      移交
                                    </button>
                                  )}
                                  <button onClick={() => setCorrectingId(s.id)}>更正</button>
                                  <button onClick={() => setRevisionSpecimenId(s.id)}>
                                    修订链{revCount > 0 ? `（${revCount}）` : ""}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          ) : (
            <section className="panel">
              <p className="empty">尚未建立探方，请先在左侧「新增探方」。</p>
            </section>
          )}
        </div>

        <div className="right-col">
          <section className="panel">
            <div className="section-heading">
              <div>
                <p>闭环校验</p>
                <h2>冲突记录（{store.conflicts.length}）</h2>
              </div>
              {store.conflicts.length > 0 && (
                <button onClick={() => act({ type: "clear-conflicts" })}>清空</button>
              )}
            </div>
            {store.conflicts.length === 0 ? (
              <p className="empty">暂无冲突：探方、地层、出土物与修订链一致。</p>
            ) : (
              <div className="conflict-list">
                {store.conflicts.map((c) => (
                  <article key={c.id} className="conflict-card">
                    <strong>{c.message}</strong>
                    <dl>
                      <div>
                        <dt>探方</dt>
                        <dd>{c.trenchName}</dd>
                      </div>
                      <div>
                        <dt>地层</dt>
                        <dd>{c.layerName}</dd>
                      </div>
                      <div>
                        <dt>坐标</dt>
                        <dd>{c.coordinate}</dd>
                      </div>
                      <div>
                        <dt>原值</dt>
                        <dd>{c.oldValue}</dd>
                      </div>
                      <div>
                        <dt>新值</dt>
                        <dd>{c.newValue}</dd>
                      </div>
                    </dl>
                    <time>{c.createdAt}</time>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>更正留痕 · 原值永久保留</p>
                <h2>修订链</h2>
              </div>
            </div>
            {revisionSpecimen ? (
              <>
                <div className="specimen-summary">
                  <strong>
                    {revisionSpecimen.specimenNo} · {revisionSpecimen.name}
                  </strong>
                  <span>
                    当前 {fmtCoord(revisionSpecimen.coord)} · {revisionSpecimen.count} 件 ·{" "}
                    {revisionSpecimen.frozen ? "已移交冻结" : "在册"}
                  </span>
                </div>
                {specimenRevisions.length === 0 ? (
                  <p className="empty">该标本暂无修订记录。</p>
                ) : (
                  <ol className="revision-chain">
                    {specimenRevisions.map((rv) => (
                      <li key={rv.id}>
                        <time>{rv.createdAt}</time>
                        <p className="reason">原因：{rv.reason}</p>
                        <ul>
                          {rv.changes.map((ch, i) => (
                            <li key={i}>
                              {ch.field}：<del>{ch.oldValue}</del> → <ins>{ch.newValue}</ins>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : (
              <p className="empty">在出土物列表中点击「修订链」查看。</p>
            )}
          </section>
        </div>
      </section>

      {correcting && (
        <CorrectModal
          key={correcting.id}
          specimen={correcting}
          layer={layerById.get(correcting.layerId)}
          onClose={() => setCorrectingId(null)}
          onSubmit={(p) => {
            const ev = act({
              type: "correct-specimen",
              specimenId: correcting.id,
              name: p.name,
              coord: { e: p.e, n: p.n, depth: p.depth },
              count: p.count,
              reason: p.reason,
            });
            if (ev?.kind === "ok") setCorrectingId(null);
          }}
        />
      )}
    </main>
  );
}

export default App;
