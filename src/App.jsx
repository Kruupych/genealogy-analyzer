import React, { useMemo, useState, useEffect, useRef } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  Handle,
  Position,
} from "reactflow";
import "reactflow/dist/style.css";
import { motion } from "framer-motion";
import { Download, Plus, Link2, Users, Wand2, Sigma } from "lucide-react";
import dagre from "@dagrejs/dagre";

/**
 * Одностраничное приложение для визуального разбора родственных связей.
 * — TailwindCSS для стилей
 * — React Flow для диаграммы
 * — framer-motion для анимаций
 * — dagre для авто-раскладки графа
 *
 * Возможности:
 * 1) Добавляйте людей и задавайте связи «родитель → ребёнок».
 * 2) Схема рисуется автоматически, узлы можно перетаскивать вручную.
 * 3) Анализируйте степень родства между двумя выбранными людьми.
 * 4) Кнопка «Загрузить пример» создаёт граф по фразе:
 *    «его мать — младшая сестра её деда по материнской линии»
 *    и показывает, что он — её двоюродный дядя, а она — его двоюродная племянница.
 */

// Утилита: генерация коротких id
let _id = 1;
const genId = () => String(_id++);

/** @typedef {"male"|"female"|"unknown"} Sex */

/** @typedef {{ id: string, name: string, sex: Sex, note?: string, birthYear?: number }} Person */
/** @typedef {{ parentId: string, childId: string }} ParentEdge */

// Авто-раскладка графа с помощью dagre
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 220;
const nodeHeight = 86;

function getLayoutedElements(nodes, edges, direction = "TB") {
  const isHorizontal = direction === "LR";
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 36,
    ranksep: 72,
    marginx: 20,
    marginy: 20,
  });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });
  edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target));

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const { x, y } = dagreGraph.node(node.id);
    node.targetPosition = isHorizontal ? "left" : "top";
    node.sourcePosition = isHorizontal ? "right" : "bottom";
    node.position = { x: x - nodeWidth / 2, y: y - nodeHeight / 2 };
    return node;
  });

  return { nodes: layoutedNodes, edges };
}

// Набор русских наименований степеней кузенства
const cousinDegreeWord = (n) => {
  if (n <= 0) return "";
  switch (n) {
    case 1:
      return "двоюродн"; // дружим с окончаниями ниже
    case 2:
      return "троюродн";
    case 3:
      return "четвероюродн";
    case 4:
      return "пятоюродн";
    default:
      return `${n}-юродн`;
  }
};

const sexNoun = (sex, male, female, neutral = male) =>
  sex === "female" ? female : sex === "male" ? male : neutral;

// База цветов и бейджей
const sexBadge = (sex) => {
  switch (sex) {
    case "male":
      return { text: "Мужчина", cls: "bg-blue-100 text-blue-700" };
    case "female":
      return { text: "Женщина", cls: "bg-pink-100 text-pink-700" };
    default:
      return { text: "Пол не указан", cls: "bg-slate-100 text-slate-600" };
  }
};

const applyParsed = ({ people: P, rels: R }) => {
  setPeople(P);
  setRels(R);
  const he = P.find((x) => x.name === "Он");
  const she = P.find((x) => x.name === "Она");
  if (he) setFromSel(he.id);
  if (she) setToSel(she.id);
};

// Компонент узла для ReactFlow
const PersonNode = ({ data }) => {
  const badge = sexBadge(data.sex);
  return (
    <div className="rounded-2xl shadow-sm border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 w-[220px] h-[86px] overflow-hidden">
      <div className="px-3 py-2 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white dark:from-slate-800 dark:to-slate-900">
        <div className="font-semibold text-slate-800 dark:text-slate-100 truncate" title={data.name}>
          {data.name}
        </div>
        <Users className="w-4 h-4 text-slate-500" />
      </div>
      <div className="px-3 py-2 flex items-center gap-2">
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>
        {data.note ? (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700" title={data.note}>
            {data.note}
          </span>
        ) : null}
      </div>
      {/* Контактные площадки для рёбер */}
      <Handle type="target" id="t" position={Position.Top} className="!w-2 !h-2 !bg-slate-400 !border-0 hover:!bg-slate-600" />
      <Handle type="source" id="s" position={Position.Bottom} className="!w-2 !h-2 !bg-slate-400 !border-0 hover:!bg-slate-600" />
    </div>
  );
};

const nodeTypes = { person: PersonNode };

// Главная логика анализа родства
function buildIndexes(people, edges) {
  /** @type {Record<string, Person>} */
  const byId = {};
  people.forEach((p) => (byId[p.id] = p));

  /** @type {Record<string, string[]>} */
  const parentsOf = {};
  /** @type {Record<string, string[]>} */
  const childrenOf = {};

  people.forEach((p) => {
    parentsOf[p.id] = [];
    childrenOf[p.id] = [];
  });
  edges.forEach((e) => {
    if (!parentsOf[e.childId]) parentsOf[e.childId] = [];
    if (!childrenOf[e.parentId]) childrenOf[e.parentId] = [];
    parentsOf[e.childId].push(e.parentId);
    childrenOf[e.parentId].push(e.childId);
  });

  return { byId, parentsOf, childrenOf };
}

function getAncestors(id, parentsOf) {
  /** @type {Record<string, number>} */
  const depths = {};
  const queue = [{ id, d: 0 }];
  const seen = new Set([id]);
  while (queue.length) {
    const { id: cur, d } = queue.shift();
    const ps = parentsOf[cur] || [];
    for (const p of ps) {
      if (!seen.has(p)) {
        depths[p] = (depths[p] ?? Infinity) < d + 1 ? depths[p] : d + 1;
        seen.add(p);
        queue.push({ id: p, d: d + 1 });
      }
    }
  }
  return depths; // ancestorId -> depth up from original
}

function findLCA(a, b, parentsOf) {
  const A = getAncestors(a, parentsOf);
  const B = getAncestors(b, parentsOf);
  let best = null; // { id, dA, dB }
  for (const id of Object.keys(A)) {
    if (id in B) {
      const dA = A[id];
      const dB = B[id];
      if (!best) best = { id, dA, dB };
      else {
        const curScore = dA + dB;
        const bestScore = best.dA + best.dB;
        if (curScore < bestScore || (curScore === bestScore && Math.max(dA, dB) < Math.max(best.dA, best.dB))) {
          best = { id, dA, dB };
        }
      }
    }
  }
  return best; // может быть null, если нет общего предка в графе
}

function isAncestorOf(a, b, parentsOf) {
  // a — предок b ?
  const ancestors = getAncestors(b, parentsOf);
  return a in ancestors ? ancestors[a] : -1;
}

function pathToAncestor(fromId, ancestorId, parentsOf) {
  // Один из возможных путей "вверх" до предка (для объяснений)
  const res = [];
  let currentLayer = [fromId];
  const prev = {};
  const seen = new Set(currentLayer);
  while (currentLayer.length) {
    const next = [];
    for (const v of currentLayer) {
      if (v === ancestorId) {
        // восстановим путь
        const path = [];
        let u = v;
        while (u && u !== fromId) {
          path.push(u);
          u = prev[u];
        }
        path.reverse();
        return [fromId, ...path];
      }
      for (const p of parentsOf[v] || []) {
        if (!seen.has(p)) {
          seen.add(p);
          prev[p] = v;
          next.push(p);
        }
      }
    }
    currentLayer = next;
  }
  return [fromId];
}

function describeLine(byId, path) {
  // Возвращает «по материнской/отцовской линии», если первый шаг — мать/отец
  if (!path || path.length < 2) return "";
  const firstParent = byId[path[1]];
  if (!firstParent) return "";
  if (firstParent.sex === "female") return "по материнской линии";
  if (firstParent.sex === "male") return "по отцовской линии";
  return "";
}

function relationLabel(fromId, toId, people, edges) {
  const { byId, parentsOf } = buildIndexes(people, edges);
  const A = byId[fromId];
  const B = byId[toId];
  if (!A || !B) return { title: "—", details: [], reverseTitle: "—" };

  // Прямое восхождение/нисхождение
  const up = isAncestorOf(fromId, toId, parentsOf); // from — предок to?
  const down = isAncestorOf(toId, fromId, parentsOf); // to — предок from?

  const describeAncestor = (d, sex) => {
    if (d === 1) return sexNoun(sex, "отец", "мать", "родитель");
    if (d === 2) return sexNoun(sex, "дед", "бабушка", "предок");
    if (d === 3) return sexNoun(sex, "прадед", "прабабушка", "предок в 3-м колене");
    return `предок в ${d}-м колене`;
  };
  const describeDescendant = (d, sex) => {
    if (d === 1) return sexNoun(sex, "сын", "дочь", "ребёнок");
    if (d === 2) return sexNoun(sex, "внук", "внучка", "потомок");
    if (d === 3) return sexNoun(sex, "правнук", "правнучка", "потомок в 3-м колене");
    return `потомок в ${d}-м колене`;
  };

  const details = [];

  if (up >= 1) {
    const path = pathToAncestor(toId, fromId, parentsOf); // to -> ... -> from
    const line = describeLine(byId, path);
    const t = describeAncestor(up, A.sex);
    const title = line ? `${t} (${line})` : t;
    // reverse
    const reverse = describeDescendant(up, B.sex);
    const revTitle = line ? `${reverse} (${line})` : reverse;
    details.push(`Общий путь: ${path.map((id) => byId[id]?.name).join(" → ")}`);
    return { title, details, reverseTitle: revTitle };
  }
  if (down >= 1) {
    const path = pathToAncestor(fromId, toId, parentsOf); // from -> ... -> to
    const line = describeLine(byId, path);
    const t = describeDescendant(down, A.sex);
    const title = line ? `${t} (${line})` : t;
    const reverse = describeAncestor(down, B.sex);
    const revTitle = line ? `${reverse} (${line})` : reverse;
    details.push(`Общий путь: ${path.map((id) => byId[id]?.name).join(" → ")}`);
    return { title, details, reverseTitle: revTitle };
  }

  const lca = findLCA(fromId, toId, parentsOf);
  if (!lca) return { title: "Связь не найдена", details: [], reverseTitle: "Связь не найдена" };

  const { id: anc, dA: k, dB: l } = lca;
  // Сиблинги
  if (k === 1 && l === 1) {
    const title = sexNoun(B.sex, "брат", "сестра", "сиблинг");
    const rev = sexNoun(A.sex, "брат", "сестра", "сиблинг");
    const pathA = pathToAncestor(fromId, anc, parentsOf);
    const pathB = pathToAncestor(toId, anc, parentsOf);
    const lineA = describeLine(byId, pathA);
    const lineB = describeLine(byId, pathB);
    const det = [
      `Общий предок: ${byId[anc]?.name}`,
      `Линии: ${lineA || "—"} / ${lineB || "—"}`,
    ];
    return { title, details: det, reverseTitle: rev };
  }

  // Тётя/дядя ↔ племянник/племянница (удалённые или нет)
  if (Math.min(k, l) === 1) {
    // Один на 1 поколение от LCA — это брат/сестра родителя/деда...
    const olderIsA = k === 1; // A ближе к предку → A старше по поколению
    const degree = Math.max(k, l) - 1; // 1 => тётя/дядя; 2 => двоюродный дед/бабушка и т.д.

    if (degree === 1) {
      // классическая тётя/дядя
      if (olderIsA) {
        const title = sexNoun(A.sex, "дядя", "тётя", "тётя/дядя");
        const reverseTitle = sexNoun(B.sex, "племянник", "племянница", "племянник/племянница");
        const det = [
          `Общий предок: ${byId[anc]?.name}`,
        ];
        return { title, details: det, reverseTitle };
      } else {
        const title = sexNoun(A.sex, "племянник", "племянница", "племянник/племянница");
        const reverseTitle = sexNoun(B.sex, "дядя", "тётя", "тётя/дядя");
        const det = [
          `Общий предок: ${byId[anc]?.name}`,
        ];
        return { title, details: det, reverseTitle };
      }
    } else {
      // удалённые: двоюродный дед/бабушка, троюродный дед/бабушка и пр.
      if (olderIsA) {
        const base = degree === 2 ? sexNoun(A.sex, "двоюродный дед", "двоюродная бабушка", "двоюродный предок")
          : degree === 3 ? sexNoun(A.sex, "троюродный дед", "троюродная бабушка", "троюродный предок")
          : `предок (удаление ${degree - 1})`;
        const title = base;
        const reverseTitle = degree === 2 ? sexNoun(B.sex, "двоюродный внук", "двоюродная внучка", "двоюродный потомок")
          : degree === 3 ? sexNoun(B.sex, "троюродный внук", "троюродная внучка", "троюродный потомок")
          : `потомок (удаление ${degree - 1})`;
        return { title, details: [`Общий предок: ${byId[anc]?.name}`], reverseTitle };
      } else {
        const base = degree === 2 ? sexNoun(A.sex, "двоюродный внук", "двоюродная внучка", "двоюродный потомок")
          : degree === 3 ? sexNoun(A.sex, "троюродный внук", "троюродная внучка", "троюродный потомок")
          : `потомок (удаление ${degree - 1})`;
        const title = base;
        const reverseTitle = degree === 2 ? sexNoun(B.sex, "двоюродный дед", "двоюродная бабушка", "двоюродный предок")
          : degree === 3 ? sexNoun(B.sex, "троюродный дед", "троюродная бабушка", "троюродный предок")
          : `предок (удаление ${degree - 1})`;
        return { title, details: [`Общий предок: ${byId[anc]?.name}`], reverseTitle };
      }
    }
  }

  // Кузены (двоюродные/троюродные ...) и удаление
  const degree = Math.min(k, l) - 1; // 1 => двоюродные, 2 => троюродные, ...
  const removal = Math.abs(k - l);

  const base = cousinDegreeWord(degree);
  if (removal === 0) {
    // Двоюродный брат/сестра
    const title = base
      ? sexNoun(B.sex, `${base}ый брат`, `${base}ая сестра`, `${base}ые родственники`)
      : "родственники";
    const reverseTitle = base
      ? sexNoun(A.sex, `${base}ый брат`, `${base}ая сестра`, `${base}ые родственники`)
      : "родственники";
    const det = [`Общий предок: ${people.find((p) => p.id === anc)?.name}`];
    return { title, details: det, reverseTitle };
  }

  // Удалённые кузены: «двоюродный дядя/тётя» и «двоюродный племянник/племянница» на 1 удалении
  if (removal === 1) {
    // Старшая сторона (ближе к LCA) — становится «двоюродный дядя/тётя»
    const olderIsA = k < l; // меньше шагов вверх до LCA → старше
    const labelOlder = `${base}ый ${sexNoun(olderIsA ? A.sex : B.sex, "дядя", "тётя", "дядя/тётя")}`;
    const labelYounger = `${base}ая ${sexNoun(olderIsA ? B.sex : A.sex, "племянник", "племянница", "племянник/племянница")}`;
    if (olderIsA) {
      return {
        title: labelOlder,
        details: [`Общий предок: ${people.find((p) => p.id === anc)?.name}`],
        reverseTitle: labelYounger,
      };
    } else {
      return {
        title: labelYounger,
        details: [`Общий предок: ${people.find((p) => p.id === anc)?.name}`],
        reverseTitle: labelOlder,
      };
    }
  }

  // Обобщённый случай удалённых кузенов > 1
  const olderIsA = k < l;
  const title = olderIsA
    ? `${base}ый ${sexNoun(A.sex, "дядя", "тётя", "дядя/тётя")} (удаление ${removal})`
    : `${base}ая ${sexNoun(A.sex, "племянник", "племянница", "племянник/племянница")} (удаление ${removal})`;
  const reverseTitle = olderIsA
    ? `${base}ая ${sexNoun(B.sex, "племянник", "племянница", "племянник/племянница")} (удаление ${removal})`
    : `${base}ый ${sexNoun(B.sex, "дядя", "тётя", "дядя/тётя")} (удаление ${removal})`;
  return { title, details: [`Общий предок: ${people.find((p) => p.id === anc)?.name}`], reverseTitle };
}

// Набор демо-данных из фразы «его мать — младшая сестра её деда по материнской линии»
function buildDemo() {
  _id = 1; // сбросим счётчик для предсказуемости
  /** @type {Person[]} */
  const people = [];
  /** @type {ParentEdge[]} */
  const rels = [];

  const add = (name, sex, note) => {
    const p = { id: genId(), name, sex, note };
    people.push(p);
    return p;
  };
  const link = (parent, child) => rels.push({ parentId: parent.id, childId: child.id });

  const she = add("Она", "female");
  const herMother = add("Её мать", "female");
  const herMGF = add("Её дед (по материнской линии)", "male");
  const herMGM = add("Её бабушка (по материнской линии)", "female");

  link(herMother, she);
  link(herMGF, herMother);
  link(herMGM, herMother);

  const hisMother = add("Его мать", "female", "младшая сестра её деда");
  const he = add("Он", "male");
  link(hisMother, he);

  // Общие родители для её деда и его матери — чтобы зафиксировать «сиблинговость»
  const commonGF = add("Общий прадед", "male");
  const commonGM = add("Общая прабабушка", "female");
  link(commonGF, herMGF);
  link(commonGM, herMGF);
  link(commonGF, hisMother);
  link(commonGM, hisMother);

  return { people, rels };
}

// Простые самотесты логики отношений (консольные)
function runSelfTests() {
  const tests = [];
  const addTest = (name, fn) => tests.push({ name, fn });
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };

  // Тест 1: демо-кейс — он → она
  addTest("Demo: Он является двоюродным дядей для Неё", () => {
    const { people, rels } = buildDemo();
    const he = people.find((p) => p.name === "Он");
    const she = people.find((p) => p.name === "Она");
    const r1 = relationLabel(he.id, she.id, people, rels);
    const r2 = relationLabel(she.id, he.id, people, rels);
    if (!r1 || !r2) throw new Error("relationLabel вернул null");
    assert(/дяд/i.test(r1.title) && /двоюродн/i.test(r1.title), `Ожидали «двоюродный дядя», получили: ${r1.title}`);
    assert(/племян/i.test(r2.title) && /двоюродн/i.test(r2.title), `Ожидали «двоюродная племянница», получили: ${r2.title}`);
  });

  // Тест 2: сиблинги
  addTest("Сиблинги: брат ↔ сестра", () => {
    _id = 1000;
    const people = [];
    const rels = [];
    const add = (name, sex) => {
      const p = { id: genId(), name, sex };
      people.push(p);
      return p;
    };
    const father = add("Отец", "male");
    const mother = add("Мать", "female");
    const son = add("Сын", "male");
    const daughter = add("Дочь", "female");
    rels.push(
      { parentId: father.id, childId: son.id },
      { parentId: mother.id, childId: son.id },
      { parentId: father.id, childId: daughter.id },
      { parentId: mother.id, childId: daughter.id }
    );
    const r = relationLabel(son.id, daughter.id, people, rels);
    assert(/сестра|брат|сиблинг/i.test(r.title), `Ожидали сиблингов, получили: ${r.title}`);
  });

  // Тест 3: предок по материнской линии
  addTest("Предок: мать → ребёнок (по материнской линии)", () => {
    _id = 2000;
    const people = [];
    const rels = [];
    const add = (name, sex) => {
      const p = { id: genId(), name, sex };
      people.push(p);
      return p;
    };
    const mom = add("Мама", "female");
    const child = add("Ребёнок", "male");
    rels.push({ parentId: mom.id, childId: child.id });
    const r = relationLabel(mom.id, child.id, people, rels);
    assert(/мать|родитель/i.test(r.title), `Ожидали «мать», получили: ${r.title}`);
    assert(/материнской/i.test(r.title), `Ожидали пометку «по материнской линии», получили: ${r.title}`);
  });

  const passed = [];
  const failed = [];
  tests.forEach((t) => {
    try {
      t.fn();
      passed.push(t.name);
    } catch (e) {
      failed.push({ name: t.name, error: e.message });
    }
  });

  if (failed.length) {
    console.group("%cGenealogyApp self-tests","color:#b91c1c");
    failed.forEach((f) => console.error("FAIL:", f.name, "-", f.error));
    console.groupEnd();
  } else {
    console.log("%cGenealogyApp self-tests passed","color:#059669");
  }
}

export default function GenealogyApp() {
  // Состояния данных
  const [people, setPeople] = useState(/** @type {Person[]} */ ([]));
  const [rels, setRels] = useState(/** @type {ParentEdge[]} */ ([]));

  // UI: формы
  const [newName, setNewName] = useState("");
  const [newSex, setNewSex] = useState(/** @type {Sex} */ ("unknown"));
  const [parentSel, setParentSel] = useState("");
  const [childSel, setChildSel] = useState("");

  // Анализ
  const [fromSel, setFromSel] = useState("");
  const [toSel, setToSel] = useState("");

  // Настройки рёбер
  const [edgeAnimated, setEdgeAnimated] = useState(true);
  const [edgeArrows, setEdgeArrows] = useState(true);

  // Диаграмма
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const flowRef = useRef(null);

  // Запустим самотесты один раз при монтировании в браузере
  useEffect(() => {
    try { runSelfTests(); } catch (e) { console.warn("Self-tests runtime error:", e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const defaultEdgeOptions = useMemo(() => ({
    type: "smoothstep",
    animated: edgeAnimated,
    style: { stroke: "#334155", strokeWidth: 2.4, strokeLinecap: "round" },
    markerEnd: edgeArrows ? { type: MarkerType.ArrowClosed, color: "#334155", width: 18, height: 18 } : undefined,
  }), [edgeAnimated, edgeArrows]);

  const rebuildFlow = () => {
    // Узлы
    const fNodes = people.map((p) => ({
      id: p.id,
      type: "person",
      data: { ...p },
      position: { x: 0, y: 0 },
    }));
    // Рёбра
    const fEdges = rels.map((e, i) => ({
      id: `e${i}`,
      source: e.parentId,
      target: e.childId,
      sourceHandle: "s",
      targetHandle: "t",
      type: "smoothstep",
      animated: edgeAnimated,
      style: { stroke: "#334155", strokeWidth: 2.4, strokeLinecap: "round" },
      markerEnd: edgeArrows ? {
        type: MarkerType.ArrowClosed,
        color: "#334155",
        width: 18,
        height: 18,
      } : undefined,
    }));
    const { nodes: layoutedNodes } = getLayoutedElements(fNodes, fEdges, "TB");
    setNodes(layoutedNodes);
    setEdges(fEdges);
  };

  useEffect(() => {
    rebuildFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, rels, edgeAnimated, edgeArrows]);

  const onConnect = (params) => setEdges((eds) => addEdge(params, eds));

  const addPerson = () => {
    if (!newName.trim()) return;
    const p = { id: genId(), name: newName.trim(), sex: newSex };
    setPeople((arr) => [...arr, p]);
    setNewName("");
    setNewSex("unknown");
  };

  const addParentChild = () => {
    if (!parentSel || !childSel || parentSel === childSel) return;
    setRels((arr) => {
      // не допускаем дублей
      if (arr.some((r) => r.parentId === parentSel && r.childId === childSel)) return arr;
      return [...arr, { parentId: parentSel, childId: childSel }];
    });
  };

  const removePerson = (id) => {
    setPeople((arr) => arr.filter((p) => p.id !== id));
    setRels((arr) => arr.filter((r) => r.parentId !== id && r.childId !== id));
    if (parentSel === id) setParentSel("");
    if (childSel === id) setChildSel("");
    if (fromSel === id) setFromSel("");
    if (toSel === id) setToSel("");
  };

  const loadDemo = () => {
    const { people: P, rels: R } = buildDemo();
    setPeople(P);
    setRels(R);
    // Предустановим сравнение Он ↔ Она
    const he = P.find((x) => x.name === "Он");
    const she = P.find((x) => x.name === "Она");
    setFromSel(he?.id || "");
    setToSel(she?.id || "");
  };

  const applyParsedScenario = (out) => {
    if (!out) return;
    const { people: P, rels: R, focusA, focusB } = out;
    setPeople(P);
    setRels(R);
    const byName = (name) => P.find((x) => x.name === name)?.id || "";
    setFromSel(focusA || byName("Он"));
    setToSel(focusB || byName("Она"));
  };


  const analysis = useMemo(() => {
    if (!fromSel || !toSel) return null;
    return relationLabel(fromSel, toSel, people, rels);
  }, [fromSel, toSel, people, rels]);

  const reverseAnalysis = useMemo(() => {
    if (!fromSel || !toSel) return null;
    return relationLabel(toSel, fromSel, people, rels);
  }, [fromSel, toSel, people, rels]);

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ people, relations: rels }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "genealogy.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (Array.isArray(data.people) && Array.isArray(data.relations)) {
          setPeople(data.people);
          setRels(data.relations);
        } else if (Array.isArray(data.people) && Array.isArray(data.rels)) {
          setPeople(data.people);
          setRels(data.rels);
        } else {
          alert("Файл не похож на экспорт этого приложения.");
        }
      } catch (e) {
        alert("Не удалось прочитать JSON: " + e.message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top Bar */}
      <div className="sticky top-0 z-20 backdrop-blur bg-white/70 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2">
            <Sigma className="w-5 h-5 text-indigo-600" />
            <div className="font-semibold tracking-tight">Генеалогический анализатор</div>
          </motion.div>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={loadDemo}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[.98] transition"
              title="Загрузить пример из задачи"
            >
              <Wand2 className="w-4 h-4" /> Загрузить пример
            </button>
            <button
              onClick={exportJSON}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 active:scale-[.98] transition"
              title="Экспортировать JSON"
            >
              <Download className="w-4 h-4" /> Экспорт
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-12 gap-4 px-4 py-4">
        {/* Левая панель: данные */}
        <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} className="col-span-12 lg:col-span-3 space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="font-semibold mb-3 flex items-center gap-2"><Users className="w-4 h-4"/> Люди</div>
            <div className="space-y-2">
              <label className="text-sm">Имя</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Имя" className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <label className="text-sm">Пол</label>
              <select value={newSex} onChange={(e) => setNewSex(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <option value="unknown">Не указан</option>
                <option value="male">Мужчина</option>
                <option value="female">Женщина</option>
              </select>
              <button onClick={addPerson} className="w-full mt-2 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[.98] transition"><Plus className="w-4 h-4"/> Добавить</button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="font-semibold mb-3 flex items-center gap-2"><Link2 className="w-4 h-4"/> Родитель → Ребёнок</div>
            <div className="space-y-2">
              <label className="text-sm">Родитель</label>
              <select value={parentSel} onChange={(e) => setParentSel(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <option value="">—</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <label className="text-sm">Ребёнок</label>
              <select value={childSel} onChange={(e) => setChildSel(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <option value="">—</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button onClick={addParentChild} className="w-full mt-2 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 active:scale-[.98] transition">Добавить связь</button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="font-semibold mb-3">Список</div>
            <div className="space-y-2 max-h-[280px] overflow-auto pr-1">
              {people.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 p-2 rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="truncate">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-slate-500">{sexBadge(p.sex).text}</div>
                  </div>
                  <button onClick={() => removePerson(p.id)} className="text-[12px] px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-rose-100 hover:text-rose-700">Удалить</button>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-slate-500">Подсказка: чтобы получить двоих сиблингов, добавьте им общих родителей.</div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="font-semibold mb-3">Импорт</div>
            <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importJSON(e.target.files[0])} className="block w-full text-sm" />
            <div className="text-xs text-slate-500 mt-2">Загрузите ранее экспортированный JSON.</div>
          </div>
        </motion.div>

        {/* Центр: диаграмма */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="col-span-12 lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3 text-sm">
            <span className="font-medium">Направление связей:</span>
            <span className="inline-flex items-center gap-1">Родитель <span aria-hidden>→</span> Ребёнок</span>
            <label className="ml-auto inline-flex items-center gap-2 text-xs select-none">
              <input type="checkbox" className="accent-indigo-600" checked={edgeArrows} onChange={(e) => setEdgeArrows(e.target.checked)} />
              Показать стрелки
            </label>
            <label className="inline-flex items-center gap-2 text-xs select-none">
              <input type="checkbox" className="accent-violet-600" checked={edgeAnimated} onChange={(e) => setEdgeAnimated(e.target.checked)} />
              Анимация связей
            </label>
          </div>
          <div className="h-[640px]" ref={flowRef}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              connectionLineType="smoothstep"
              fitView
            >
              <Controls position="top-left" />
              <MiniMap pannable zoomable />
              <Background gap={16} />
            </ReactFlow>
          </div>
        </motion.div>

        {/* Правая панель: анализ */}
        <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="col-span-12 lg:col-span-3 space-y-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="font-semibold mb-3 flex items-center gap-2"><Sigma className="w-4 h-4"/> Анализ связи</div>
            <div className="space-y-2">
              <label className="text-sm">Персона А</label>
              <select value={fromSel} onChange={(e) => setFromSel(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <option value="">—</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <label className="text-sm">Персона B</label>
              <select value={toSel} onChange={(e) => setToSel(e.target.value)} className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <option value="">—</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>

              {analysis ? (
                <div className="mt-3 space-y-2">
                  <div className="p-3 rounded-xl bg-indigo-50 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-200">
                    <div className="text-xs uppercase tracking-wide opacity-70">A → B</div>
                    <div className="font-semibold text-sm">{analysis.title}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
                    <div className="text-xs uppercase tracking-wide opacity-70">B → A</div>
                    <div className="font-semibold text-sm">{analysis.reverseTitle}</div>
                  </div>
                  {analysis.details?.length ? (
                    <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                      {analysis.details.map((d, i) => (
                        <div key={i}>• {d}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-2 text-sm text-slate-500">Выберите двух людей для анализа.</div>
              )}

              <div className="mt-4 text-xs text-slate-500">
                Подсказка: добавьте общих предков, чтобы корректно распознавались «сестра/брат», «тётя/дядя», «двоюродные» и т.д.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
            <div className="font-semibold mb-3 flex items-center gap-2"><Wand2 className="w-4 h-4"/> Быстрый парсер (демо)</div>
            <div className="text-sm text-slate-600 dark:text-slate-400 mb-2">
              Введите фразу наподобие <span className="font-mono">«его мать -/— младшая сестра её/ее деда по материнской линии»</span> и нажмите Преобразовать.
            </div>
            <QuickParser onDemo={loadDemo} onApply={applyParsed} />
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// Нормализация текста (устойчиво к тире, дефисам, «ё/е», пунктуации и лишним пробелам)
function normalizeText(s) {
  return (s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[–—-]/g, " ") // любые тире/дефисы → пробел
    .replace(/[^a-zа-я0-9\s]/g, " ") // убираем прочую пунктуацию
    .replace(/\s+/g, " ")
    .trim();
}

// ===== Продвинутый парсер: «его/ее <родственник> — (младшая|старшая)? (сестра|брат) ее/его <родственник> [по <линии>] =====

const PRONOUN = new Set(["его", "ее", "её"]);
const FILLERS = new Set(["это", "есть", "является", "явл"]);
const SIBLING_WORDS = new Set(["сестра", "брат"]);
const RANK_WORDS = new Set(["младшая", "старшая", "младший", "старший"]);

const motherWords = new Set(["мать", "мама"]);
const fatherWords = new Set(["отец", "папа"]);

function isGrandfatherWord(w) {
    return /^дед/.test(w) || /^дедушк/.test(w);
}

function isGrandmotherWord(w) {
    return /^баб/.test(w);
}

function takeLine(tokens, i) {
    // «по материнской линии» | «по отцовской линии»
    if (tokens[i] === "по" && (tokens[i + 1] === "материнской" || tokens[i + 1] === "отцовской") && tokens[i + 2] === "линии") {
        const side = tokens[i + 1] === "материнской" ? "maternal" : "paternal";
        return {
            side,
            next: i + 3
        };
    }
    return {
        side: null,
        next: i
    };
}

function parseRelativeSpec(tokens, i0) {
    // Ожидаем: (его|ее|её) <мать|отец|дед|бабушка> [по <линии>]
    let i = i0;
    const pron = tokens[i];
    if (!PRONOUN.has(pron)) throw new Error("Ожидали «его/ее»");
    const base = pron === "его" ? "he" : "she";
    i++;

    const w = tokens[i];
    if (!w) throw new Error("Ожидали термин родства после «его/ее»");

    let steps = [];
    let terminalLabel = "";
    let terminalSex = "unknown";
    let note = "";

    if (motherWords.has(w)) {
        steps = ["mother"];
        terminalSex = "female";
        terminalLabel = base === "he" ? "Его мать" : "Её мать";
        i++;
    } else if (fatherWords.has(w)) {
        steps = ["father"];
        terminalSex = "male";
        terminalLabel = base === "he" ? "Его отец" : "Её отец";
        i++;
    } else if (isGrandfatherWord(w) || isGrandmotherWord(w)) {
        const gf = isGrandfatherWord(w);
        i++;
        const {
            side,
            next
        } = takeLine(tokens, i);
        i = next;

        if (!side) {
            // Без линии неоднозначно: дед может быть с мат. или отц. стороны — просим уточнить
            throw new Error("Уточните линию: «по материнской линии» или «по отцовской линии» для «дед/бабушка»");
        }

        if (side === "maternal") {
            steps = ["mother", gf ? "father" : "mother"];
        } else {
            steps = ["father", gf ? "father" : "mother"];
        }

        terminalSex = gf ? "male" : "female";
        const lineText = side === "maternal" ? "по материнской линии" : "по отцовской линии";
        // Лейбл делаем «Его/Её дед|бабушка (по ... линии)»
        const baseWord = gf ? "дед" : "бабушка";
        terminalLabel = (base === "he" ? "Его " : "Её ") + baseWord + " (" + lineText + ")";
    } else {
        throw new Error("Неизвестный термин родства: " + w);
    }

    return {
        base, // "he" | "she"
        steps, // ["mother"] | ["father"] | ["mother","father"] | ...
        terminalLabel,
        terminalSex,
        note,
        next: i,
    };
}

function parseSiblingConnector(tokens, i0) {
    // [—|-|это|есть|является]* [младшая|старшая]? (сестра|брат)
    let i = i0;
    // пропускаем «—», «-», фильтры
    while (i < tokens.length && (FILLERS.has(tokens[i]) || tokens[i] === "—" || tokens[i] === "-")) i++;

    let rank = null;
    if (i < tokens.length && RANK_WORDS.has(tokens[i])) {
        rank = tokens[i];
        i++;
    }

    if (i >= tokens.length || !SIBLING_WORDS.has(tokens[i])) {
        throw new Error("Ожидали «сестра/брат»");
    }
    const kind = tokens[i]; // "сестра" | "брат"
    i++;

    return {
        kind,
        rank,
        next: i
    };
}

function makeNodeKey(base, path) {
    return base + ":" + path.join("/");
}

function labelForPath(base, path) {
    // Генерация лейбла и пола для каждой вершины на пути
    if (path.length === 1) {
        const s = path[0];
        if (s === "mother") return {
            label: base === "he" ? "Его мать" : "Её мать",
            sex: "female"
        };
        if (s === "father") return {
            label: base === "he" ? "Его отец" : "Её отец",
            sex: "male"
        };
    }
    if (path.length === 2) {
        const [first, second] = path;
        const lineText = first === "mother" ? "по материнской линии" : "по отцовской линии";
        const isGrandfather = second === "father";
        const label =
            (base === "he" ? "Его " : "Её ") + (isGrandfather ? "дед" : "бабушка") + " (" + lineText + ")";
        const sex = isGrandfather ? "male" : "female";
        return {
            label,
            sex
        };
    }
    // Прочие колена (на будущее)
    return {
        label: (base === "he" ? "Его предок" : "Её предок") + " в " + path.length + "-м колене",
        sex: "unknown"
    };
}

function buildGraphFromSibling(leftSpec, connector, rightSpec) {
    // people, rels
    let people = [];
    let rels = [];
    let byKey = new Map();

    const add = (name, sex, note) => {
        // реюз по имени (для простоты/детерминизма парсера)
        const k = "name:" + name;
        if (byKey.has(k)) return byKey.get(k);
        const p = {
            id: genId(),
            name,
            sex,
            note
        };
        byKey.set(k, p);
        people.push(p);
        return p;
    };

    const ensureChain = (base, steps) => {
        // базовый узел «Он/Она»
        const root = add(base === "he" ? "Он" : "Она", base === "he" ? "male" : "female");
        // приращиваем путь
        let child = root;
        for (let d = 0; d < steps.length; d++) {
            const path = steps.slice(0, d + 1);
            const {
                label,
                sex
            } = labelForPath(base, path);
            const node = add(label, sex);
            // node => child (родитель -> ребёнок)
            if (!rels.some(r => r.parentId === node.id && r.childId === child.id)) {
                rels.push({
                    parentId: node.id,
                    childId: child.id
                });
            }
            child = node;
        }
        return child; // терминальный узел цепочки
    };

    // строим левую и правую ветки
    const leftNode = ensureChain(leftSpec.base, leftSpec.steps);
    if (connector.rank) {
        leftNode.note = leftNode.note ? leftNode.note + "; " + connector.rank : connector.rank;
    }
    const rightNode = ensureChain(rightSpec.base, rightSpec.steps);

    // делаем их сиблингов: добавим общих родителей
    const commonGF = add("Общий прадед", "male");
    const commonGM = add("Общая прабабушка", "female");
    // Общие родители → левый и правый
    for (const parent of [commonGF, commonGM]) {
        if (!rels.some(r => r.parentId === parent.id && r.childId === leftNode.id)) {
            rels.push({
                parentId: parent.id,
                childId: leftNode.id
            });
        }
        if (!rels.some(r => r.parentId === parent.id && r.childId === rightNode.id)) {
            rels.push({
                parentId: parent.id,
                childId: rightNode.id
            });
        }
    }

    return {
        people,
        rels
    };
}

function parseAdvancedKinship(inputText) {
    // нормализация + токенизация
    const norm = normalizeText(inputText);
    if (!norm) throw new Error("Пустая строка");
    const raw = norm.split(" ").filter(Boolean);
    // оставляем «её» как «ее» (normalizeText уже сделал), убираем длинные тире (превращены в слова «—»/«-»)
    const tokens = raw;

    let i = 0;
    const left = parseRelativeSpec(tokens, i);
    i = left.next;

    const conn = parseSiblingConnector(tokens, i);
    i = conn.next;

    const right = parseRelativeSpec(tokens, i);
    i = right.next;

    if (i < tokens.length) {
        // могут остаться хвосты вроде «и т.д.» — не критично
    }

    return buildGraphFromSibling(left, conn, right);
}


function QuickParser({
    onDemo,
    onApply
}) {
    const [text, setText] = useState("");
    const canonical = "его мать младшая сестра ее деда по материнской линии";

    const handleParse = () => {
        const norm = normalizeText(text);
        try {
            const res = parseAdvancedKinship(text);
            if (res && res.people?.length) {
                onApply(res);
                return;
            }
        } catch (e) {
            if (norm === canonical) {
                onDemo();
                return;
            }
            alert("Не удалось разобрать фразу: " + e.message + "\nПоддерживаются конструкции:\n«его/ее мать|отец — [младшая|старшая] сестра|брат ее/его деда|бабушки по материнской|отцовской линии».");
            return;
        }
    };

    return (
  <div className="space-y-2">
    <textarea value={text} onChange={(e)=> setText(e.target.value)} placeholder={"его мать — младшая сестра её деда по материнской линии"} className="w-full h-24 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleParse(); } }} />
      <button onClick={handleParse} className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-violet-600 text-white hover:bg-violet-700 active:scale-[.98] transition">
        Преобразовать в схему
      </button>
      <div className="text-[11px] text-slate-500">Подсказка: ⌘/Ctrl+Enter — преобразовать</div>
  </div>
  );
}
