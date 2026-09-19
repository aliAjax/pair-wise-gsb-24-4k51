import { useEffect, useRef, useState } from "react";
import "./styles.css";
import {
  addLayer,
  addSquare,
  closeLayer,
  fmtCoord,
  handoverArtifact,
  handoverOf,
  layersOf,
  reconcile,
  registerArtifact,
  reviseArtifact,
  revisionsOf,
} from "./domain";
import type { Archive, Artifact, Conflict, Layer, Square } from "./domain";
import { loadArchive, persist, resetArchive, STORAGE_KEY } from "./store";

type RunResult = { archive: Archive; message?: string };
type Run = (fn: (archive: Archive) => RunResult) => RunResult | null;

const fmtTime = (iso: string) => new Date(iso).toLocaleString("zh-CN", { hour12: false });
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

// ---------------------------------------------------------------- 通用小组件

function MetricCard({ label, value, index }: { label: string; value: number; index: number }) {
  const colors = ["status-ok", "status-watch", "status-danger"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={colors[index % colors.length]} />
    </article>
  );
}

function Banner({ kind, text, onClose }: { kind: "error" | "notice"; text: string; onClose: () => void }) {
  return (
    <div className={`banner ${kind}`} role="alert">
      <span>{text}</span>
      <button onClick={onClose} aria-label="关闭">
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- 探方面板

function SquarePanel({
  archive,
  selectedId,
  onSelect,
  run,
}: {
  archive: Archive;
  selectedId: string;
  onSelect: (id: string) => void;
  run: Run;
}) {
  const [name, setName] = useState("");
  const [depth, setDepth] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = run((a) => ({ archive: addSquare(a, name, num(depth)), message: `探方 ${name.trim()} 已建立` }));
    if (r) {
      const created = r.archive.squares.find((s) => s.name === name.trim());
      if (created) onSelect(created.id);
      setName("");
      setDepth("");
    }
  };

  return (
    <aside className="panel narrow">
      <h2>探方</h2>
      <div className="square-list">
        {archive.squares.map((s) => {
          const layers = layersOf(archive, s.id);
          const open = layers.filter((l) => !l.closed).length;
          const artifacts = archive.artifacts.filter((a) => a.squareId === s.id).length;
          return (
            <button
              key={s.id}
              className={"square-item" + (s.id === selectedId ? " active" : "")}
              onClick={() => onSelect(s.id)}
            >
              <strong>{s.name}</strong>
              <span>
                深度 {s.depth}cm · 地层 {layers.length} · 出土物 {artifacts}
              </span>
              {open > 0 && <em>{open} 层未闭合</em>}
            </button>
          );
        })}
      </div>
      <form className="inline-form" onSubmit={submit}>
        <h3>新增探方</h3>
        <label>
          <span>探方编号</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 T0301" />
        </label>
        <label>
          <span>探方深度（cm）</span>
          <input type="number" min="1" value={depth} onChange={(e) => setDepth(e.target.value)} placeholder="如 100" />
        </label>
        <button className="primary-action" type="submit">
          新增探方
        </button>
      </form>
    </aside>
  );
}

// ---------------------------------------------------------------- 地层面板

function LayerPanel({
  archive,
  square,
  selectedLayerId,
  onSelect,
  run,
}: {
  archive: Archive;
  square: Square;
  selectedLayerId: string | null;
  onSelect: (id: string) => void;
  run: Run;
}) {
  const layers = layersOf(archive, square.id);
  const nextTop = layers.length ? layers[layers.length - 1].bottomDepth : 0;
  const full = nextTop >= square.depth;
  const [name, setName] = useState("");
  const [soil, setSoil] = useState("");
  const [bottom, setBottom] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = run((a) => ({
      archive: addLayer(a, square.id, name, soil, num(bottom)),
      message: `地层已登记：顶深承接 ${nextTop}cm`,
    }));
    if (r) {
      const all = layersOf(r.archive, square.id);
      const created = all[all.length - 1];
      if (created) onSelect(created.id);
      setName("");
      setSoil("");
      setBottom("");
    }
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>
            {square.name} · 探方深度 {square.depth}cm
          </p>
          <h2>地层</h2>
        </div>
      </div>

      <div className="strat-wrap">
        <div className="strat-column">
          {layers.map((l) => (
            <div
              key={l.id}
              className={
                "strat-band" + (l.closed ? " closed" : "") + (l.id === selectedLayerId ? " active" : "")
              }
              style={{ flexGrow: Math.max(l.bottomDepth - l.topDepth, 1) }}
              onClick={() => onSelect(l.id)}
              title={`${l.name} ${l.topDepth}–${l.bottomDepth}cm`}
            >
              <span>{l.name}</span>
              <small>
                {l.topDepth}–{l.bottomDepth}cm
              </small>
            </div>
          ))}
          {!full && (
            <div className="strat-band virgin" style={{ flexGrow: Math.max(square.depth - nextTop, 1) }}>
              <span>未发掘</span>
              <small>
                {nextTop}–{square.depth}cm
              </small>
            </div>
          )}
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>地层</th>
              <th>顶深</th>
              <th>底深</th>
              <th>土色</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {layers.map((l) => (
              <tr
                key={l.id}
                className={l.id === selectedLayerId ? "active" : ""}
                onClick={() => onSelect(l.id)}
              >
                <td>{l.name}</td>
                <td>{l.topDepth}cm</td>
                <td>{l.bottomDepth}cm</td>
                <td>{l.soil}</td>
                <td>{l.closed ? <span className="badge ok">已闭合</span> : <span className="badge warn">未闭合</span>}</td>
                <td>
                  {!l.closed && (
                    <button
                      className="row-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        run((a) => ({ archive: closeLayer(a, l.id), message: `${square.name} ${l.name} 已闭合` }));
                      }}
                    >
                      闭合
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {layers.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  尚无地层，请在下方登记
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <form className="inline-form cols-4" onSubmit={submit}>
        <p className="form-hint">
          {full
            ? "探方已发掘至底深，不能再新增地层"
            : `新地层顶深自动承接上层层底 ${nextTop}cm，底深不得超出探方深度 ${square.depth}cm`}
        </p>
        <label>
          <span>地层名称</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`第${layers.length + 1}层`} disabled={full} />
        </label>
        <label>
          <span>土色</span>
          <input value={soil} onChange={(e) => setSoil(e.target.value)} placeholder="如 灰褐土" disabled={full} />
        </label>
        <label>
          <span>底深（cm）</span>
          <input
            type="number"
            value={bottom}
            onChange={(e) => setBottom(e.target.value)}
            placeholder={`>${nextTop} 且 ≤${square.depth}`}
            disabled={full}
          />
        </label>
        <button className="primary-action" type="submit" disabled={full}>
          新增地层
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- 出土物面板

function ArtifactPanel({
  archive,
  square,
  layer,
  selectedArtifactId,
  onSelect,
  run,
}: {
  archive: Archive;
  square: Square;
  layer: Layer | null;
  selectedArtifactId: string | null;
  onSelect: (id: string) => void;
  run: Run;
}) {
  const [name, setName] = useState("");
  const [ex, setEx] = useState("");
  const [why, setWhy] = useState("");
  const [count, setCount] = useState("");

  if (!layer) {
    return (
      <section className="panel">
        <h2>出土物</h2>
        <p className="empty">请先在地层面板选择或新增地层</p>
      </section>
    );
  }

  const artifacts = archive.artifacts.filter((a) => a.layerId === layer.id);
  const unfrozen = artifacts.filter((a) => !handoverOf(archive, a.id));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const coord = { x: num(ex), y: num(why) };
    let createdId = "";
    const r = run((a) => {
      const res = registerArtifact(a, layer.id, name, coord, num(count));
      createdId = res.artifact.id;
      return {
        archive: res.archive,
        message: res.mergedWith
          ? `坐标 ${fmtCoord(coord)} 已存在于本探方，出土物归并到标本编号 ${res.artifact.specimenNo}`
          : `已登记 ${res.artifact.name}，标本编号 ${res.artifact.specimenNo}`,
      };
    });
    if (r) {
      if (createdId) onSelect(createdId);
      setName("");
      setEx("");
      setWhy("");
      setCount("");
    }
  };

  const handoverAll = () => {
    const ids = unfrozen.map((a) => a.id);
    run((a) => {
      let next = a;
      for (const id of ids) next = handoverArtifact(next, id);
      return { archive: next, message: `${layer.name} 已整层移交冻结 ${ids.length} 件` };
    });
  };

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>
            {square.name} · {layer.name}（{layer.topDepth}–{layer.bottomDepth}cm）
          </p>
          <h2>出土物</h2>
        </div>
        <button onClick={handoverAll} disabled={unfrozen.length === 0}>
          整层移交冻结
        </button>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>标本编号</th>
            <th>名称</th>
            <th>坐标</th>
            <th>件数</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {artifacts.map((a) => {
            const ho = handoverOf(archive, a.id);
            const revs = revisionsOf(archive, a.id);
            return (
              <tr
                key={a.id}
                className={a.id === selectedArtifactId ? "active" : ""}
                onClick={() => onSelect(a.id)}
              >
                <td>
                  {a.specimenNo}
                  {a.merged && <span className="badge info">归并</span>}
                </td>
                <td>{a.name}</td>
                <td>{fmtCoord(a.coord)}</td>
                <td>{a.count}</td>
                <td>
                  {ho ? (
                    <span className="badge ok">已冻结{revs.length > 0 ? ` · 修订${revs.length}` : ""}</span>
                  ) : (
                    <span className="badge warn">未移交</span>
                  )}
                </td>
                <td>
                  {ho ? (
                    <button className="row-action" onClick={() => onSelect(a.id)}>
                      更正
                    </button>
                  ) : (
                    <button
                      className="row-action"
                      onClick={(e) => {
                        e.stopPropagation();
                        run((ar) => ({
                          archive: handoverArtifact(ar, a.id),
                          message: `${a.specimenNo} 已移交，坐标与件数冻结`,
                        }));
                      }}
                    >
                      移交
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {artifacts.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                本层尚无出土物
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {layer.closed ? (
        <form className="inline-form cols-5" onSubmit={submit}>
          <p className="form-hint">同一探方内坐标重复的出土物将自动归并到同一标本编号</p>
          <label>
            <span>名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 陶片" />
          </label>
          <label>
            <span>东坐标 E</span>
            <input type="number" min="0" step="any" value={ex} onChange={(e) => setEx(e.target.value)} placeholder="如 3" />
          </label>
          <label>
            <span>北坐标 N</span>
            <input type="number" min="0" step="any" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="如 4" />
          </label>
          <label>
            <span>件数</span>
            <input type="number" min="1" value={count} onChange={(e) => setCount(e.target.value)} placeholder="如 1" />
          </label>
          <button className="primary-action" type="submit">
            登记出土物
          </button>
        </form>
      ) : (
        <p className="form-hint blocked">未闭合地层不得登记出土物，请先在地层面板将 {layer.name} 闭合。</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- 修订链面板

function ReviseForm({ artifact, run }: { artifact: Artifact; run: Run }) {
  const [ex, setEx] = useState(String(artifact.coord.x));
  const [why, setWhy] = useState(String(artifact.coord.y));
  const [count, setCount] = useState(String(artifact.count));
  const [reason, setReason] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const r = run((a) => ({
      archive: reviseArtifact(a, artifact.id, { coord: { x: num(ex), y: num(why) }, count: num(count) }, reason),
      message: `已新建修订，原值保留，更正原因：${reason.trim()}`,
    }));
    if (r) setReason("");
  };

  return (
    <form className="inline-form cols-5" onSubmit={submit}>
      <p className="form-hint">更正不会改写冻结值，只新建带原因的修订，原值始终保留</p>
      <label>
        <span>新东坐标 E</span>
        <input type="number" min="0" step="any" value={ex} onChange={(e) => setEx(e.target.value)} />
      </label>
      <label>
        <span>新北坐标 N</span>
        <input type="number" min="0" step="any" value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <label>
        <span>新件数</span>
        <input type="number" min="1" value={count} onChange={(e) => setCount(e.target.value)} />
      </label>
      <label>
        <span>更正原因</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="必填，如 复核发现清点错误" />
      </label>
      <button className="primary-action" type="submit">
        提交更正
      </button>
    </form>
  );
}

function ChainPanel({ archive, artifact, run }: { archive: Archive; artifact: Artifact | null; run: Run }) {
  if (!artifact) {
    return (
      <section className="panel">
        <h2>移交与修订链</h2>
        <p className="empty">在出土物列表中选择一件查看</p>
      </section>
    );
  }
  const ho = handoverOf(archive, artifact.id);
  const revs = revisionsOf(archive, artifact.id);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>
            标本 {artifact.specimenNo} · {artifact.name}
          </p>
          <h2>移交与修订链</h2>
        </div>
      </div>
      <ol className="chain">
        <li>
          <i />
          <div>
            <strong>登记</strong>
            <span>
              {fmtTime(artifact.createdAt)} · 标本编号 {artifact.specimenNo}
              {artifact.merged ? "（坐标重复，归并登记）" : ""}
            </span>
          </div>
        </li>
        <li className={ho ? "frozen" : "pending"}>
          <i />
          <div>
            <strong>{ho ? "移交冻结（原值）" : "未移交"}</strong>
            <span>
              {ho
                ? `${fmtTime(ho.at)} · ${fmtCoord(ho.coord)} · ${ho.count}件`
                : "移交后坐标与件数即冻结，之后只能走修订"}
            </span>
          </div>
        </li>
        {revs.map((r, idx) => (
          <li key={r.id} className="revision">
            <i />
            <div>
              <strong>更正 {idx + 1}</strong>
              <span>
                {fmtTime(r.at)} · 原值 {fmtCoord(r.original.coord)} · {r.original.count}件 → 新值{" "}
                {fmtCoord(r.next.coord)} · {r.next.count}件
              </span>
              <small>原因：{r.reason}</small>
            </div>
          </li>
        ))}
        <li className="current">
          <i />
          <div>
            <strong>当前值</strong>
            <span>
              {fmtCoord(artifact.coord)} · {artifact.count}件
            </span>
          </div>
        </li>
      </ol>
      {ho && (
        <ReviseForm
          key={`${artifact.id}:${artifact.coord.x},${artifact.coord.y},${artifact.count}`}
          artifact={artifact}
          run={run}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------- 冲突面板

function ConflictPanel({
  conflicts,
  onRecheck,
  onReset,
}: {
  conflicts: Conflict[];
  onRecheck: () => void;
  onReset: () => void;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>落盘一致性</p>
          <h2>冲突清单</h2>
        </div>
        <div className="actions">
          <button onClick={onRecheck}>重新校验</button>
          <button onClick={onReset}>恢复示例数据</button>
        </div>
      </div>
      <p className="form-hint">
        每次载入（刷新）都会重新校验探方、地层、出土物与修订链；冲突一律以原值为准回滚并落盘，更正须通过修订链。
      </p>
      {conflicts.length === 0 ? (
        <p className="empty">无冲突：探方、地层、出土物与修订链一致。</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>类型</th>
              <th>探方</th>
              <th>地层</th>
              <th>坐标</th>
              <th>原值</th>
              <th>新值</th>
            </tr>
          </thead>
          <tbody>
            {conflicts.map((c, i) => (
              <tr key={i}>
                <td>{c.kind}</td>
                <td>{c.square}</td>
                <td>{c.layer}</td>
                <td>{c.coord}</td>
                <td>{c.original}</td>
                <td>{c.next}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- 主界面

export default function App() {
  const [boot] = useState(() => loadArchive());
  const [archive, setArchive] = useState(boot.archive);
  const [conflicts, setConflicts] = useState(boot.conflicts);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const archiveRef = useRef(archive);
  archiveRef.current = archive;

  const [squareId, setSquareId] = useState(boot.archive.squares[0]?.id ?? "");
  const [layerId, setLayerId] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);

  // 其他标签页写入后同步重载，保持各端一致
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const loaded = loadArchive();
      archiveRef.current = loaded.archive;
      setArchive(loaded.archive);
      setConflicts(loaded.conflicts);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const run: Run = (fn) => {
    try {
      const result = fn(structuredClone(archiveRef.current));
      persist(result.archive);
      archiveRef.current = result.archive;
      setArchive(result.archive);
      setError(null);
      setNotice(result.message ?? null);
      return result;
    } catch (e) {
      setNotice(null);
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  const recheck = () => {
    const { archive: checked, conflicts: found } = reconcile(archiveRef.current);
    if (found.length > 0) persist(checked);
    archiveRef.current = checked;
    setArchive(checked);
    setConflicts(found);
    setError(null);
    setNotice(found.length > 0 ? `发现并回滚 ${found.length} 处冲突，已按原值落盘` : "校验通过，档案一致");
  };

  const reset = () => {
    const seed = resetArchive();
    archiveRef.current = seed;
    setArchive(seed);
    setConflicts([]);
    setError(null);
    setNotice("已恢复示例数据");
    setSquareId(seed.squares[0]?.id ?? "");
    setLayerId(null);
    setArtifactId(null);
  };

  const square = archive.squares.find((s) => s.id === squareId) ?? archive.squares[0] ?? null;
  const layers = square ? layersOf(archive, square.id) : [];
  const layer = layers.find((l) => l.id === layerId) ?? layers[layers.length - 1] ?? null;
  const layerArtifacts = layer ? archive.artifacts.filter((a) => a.layerId === layer.id) : [];
  const artifact =
    layerArtifacts.find((a) => a.id === artifactId) ??
    layerArtifacts.find((a) => handoverOf(archive, a.id)) ??
    layerArtifacts[0] ??
    null;

  const metrics = [
    { label: "探方数", value: archive.squares.length },
    { label: "地层数", value: archive.layers.length },
    { label: "出土物", value: archive.artifacts.length },
    { label: "修订数", value: archive.revisions.length },
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-10 · 落盘闭环</p>
          <h1>考古探方记录</h1>
          <p className="subtitle">
            探方—地层—出土物—移交—修订链闭环档案：地层顶深承接上层层底，坐标重复归并同一标本编号，
            移交即冻结坐标与件数，更正只新建带原因的修订并保留原值。数据落盘本地存储，刷新自动校验一致性。
          </p>
        </div>
        <div className="stack-card">
          <span>闭环规则</span>
          <strong>
            承接顶深 · 坐标归并
            <br />
            闭合登记 · 移交冻结
            <br />
            修订留痕 · 冲突回滚
          </strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, i) => (
          <MetricCard key={m.label} label={m.label} value={m.value} index={i} />
        ))}
      </section>

      {error && <Banner kind="error" text={error} onClose={() => setError(null)} />}
      {notice && <Banner kind="notice" text={notice} onClose={() => setNotice(null)} />}

      {square ? (
        <section className="workspace">
          <SquarePanel archive={archive} selectedId={square.id} onSelect={setSquareId} run={run} />
          <LayerPanel archive={archive} square={square} selectedLayerId={layer?.id ?? null} onSelect={setLayerId} run={run} />
          <ArtifactPanel
            archive={archive}
            square={square}
            layer={layer}
            selectedArtifactId={artifact?.id ?? null}
            onSelect={setArtifactId}
            run={run}
          />
        </section>
      ) : (
        <section className="panel">
          <p className="empty">尚无探方，请先新增探方</p>
        </section>
      )}

      <section className="bottom-grid">
        <ChainPanel archive={archive} artifact={artifact} run={run} />
        <ConflictPanel conflicts={conflicts} onRecheck={recheck} onReset={reset} />
      </section>
    </main>
  );
}
