"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import {
  DndContext, closestCenter,
  PointerSensor, TouchSensor,
  useSensor, useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext, useSortable,
  verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ── Constants ────────────────────────────────────────────────────────────────

const _now = new Date();
const TODAY = { year: _now.getFullYear(), month: _now.getMonth(), day: _now.getDate() };
const WEEK_DAYS  = ["일","월","화","수","목","금","토"];
const DAY_LABELS = ["일요일","월요일","화요일","수요일","목요일","금요일","토요일"];
const MONTH_NAMES = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

// ── Helpers ──────────────────────────────────────────────────────────────────

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getDateLabel(year: number, month: number, day: number) {
  return `${month + 1}월 ${day}일`;
}

function getDayLabel(year: number, month: number, day: number) {
  return DAY_LABELS[new Date(year, month, day).getDay()];
}

function buildCalCells(year: number, month: number): (number | null)[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const AIRPORTS = [
  { code: "ICN", label: "ICN - 인천국제공항" },
  { code: "LTN", label: "LTN - 런던 루턴공항" },
  { code: "STN", label: "STN - 런던 스탠스테드공항" },
  { code: "BCN", label: "BCN - 바르셀로나 엘프라트공항" },
  { code: "CPH", label: "CPH - 코펜하겐공항" },
  { code: "AAR", label: "AAR - 아르후스공항" },
];

const INITIAL_TRIP = {
  title: "새 여행", startDate: "", endDate: "",
  departure: "ICN", returnFlight: "ICN",
  hotel: "", route: [] as string[],
  currency: "KRW",
};

const CURRENCY_FORMAT: Record<string, { prefix: string; suffix: string; decimals: number }> = {
  KRW: { prefix: "₩",    suffix: "",      decimals: 0 },
  USD: { prefix: "$",    suffix: "",      decimals: 2 },
  EUR: { prefix: "€",    suffix: "",      decimals: 2 },
  GBP: { prefix: "£",    suffix: "",      decimals: 2 },
  JPY: { prefix: "¥",    suffix: "",      decimals: 0 },
  CNY: { prefix: "¥",    suffix: "",      decimals: 2 },
  DKK: { prefix: "",     suffix: " DKK",  decimals: 2 },
  SEK: { prefix: "",     suffix: " SEK",  decimals: 2 },
  NOK: { prefix: "",     suffix: " NOK",  decimals: 2 },
  CHF: { prefix: "CHF ", suffix: "",      decimals: 2 },
  CAD: { prefix: "CA$",  suffix: "",      decimals: 2 },
  AUD: { prefix: "A$",   suffix: "",      decimals: 2 },
};

function formatAmount(amount: number, currency: string): string {
  const fmt = CURRENCY_FORMAT[currency] ?? { prefix: "", suffix: ` ${currency}`, decimals: 2 };
  const num = fmt.decimals === 0
    ? Math.round(amount).toLocaleString("ko-KR")
    : amount.toFixed(fmt.decimals);
  return `${fmt.prefix}${num}${fmt.suffix}`;
}

const CURRENCY_OPTIONS = [
  { code: "KRW", label: "₩ KRW" },
  { code: "USD", label: "$ USD" },
  { code: "EUR", label: "€ EUR" },
  { code: "GBP", label: "£ GBP" },
  { code: "JPY", label: "¥ JPY" },
  { code: "CNY", label: "¥ CNY" },
  { code: "DKK", label: "DKK" },
  { code: "SEK", label: "SEK" },
  { code: "NOK", label: "NOK" },
  { code: "CHF", label: "CHF" },
  { code: "CAD", label: "CA$" },
  { code: "AUD", label: "A$" },
];

const CHECKLIST_TEMPLATE = ["여권", "충전기", "보조배터리", "멀티어댑터", "유심", "상비약"];

const BOOKING_TYPE_CFG = {
  flight:    { emoji: "✈️", label: "항공",   bg: "#dbeafe", text: "#1d4ed8" },
  hotel:     { emoji: "🏨", label: "숙소",   bg: "#fef9c3", text: "#92400e" },
  transport: { emoji: "🚆", label: "교통",   bg: "#dcfce7", text: "#166534" },
  ticket:    { emoji: "🎫", label: "입장권", bg: "#f3e8ff", text: "#7e22ce" },
} as const;

const BOOKING_FORM_INIT = {
  type: "flight" as BookingType, title: "",
  start_date: "", start_time: "", end_date: "", end_time: "",
  link: "", memo: "", provider: "", booking_ref: "",
  event_link_id: "",  // 예약 생성 시 연결할 일정
};

const CATEGORY_ICON: Record<string, string> = {
  food: "🍽️", transport: "🚌", stay: "🏨", activity: "📍", shopping: "🛍️", other: "📝",
};
const CATEGORY_LABEL: Record<string, string> = {
  food: "식비", transport: "교통", stay: "숙소", activity: "관광", shopping: "쇼핑", other: "기타",
};

function formatDateDisplay(s: string) {
  if (!s) return "";
  const [, m, d] = s.split("-").map(Number);
  return `${m}월 ${d}일`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Location = { place_id: string; name: string; lat: number; lng: number };
type Event = { id: string; time: string; title: string; tag: string; detail: string; location?: Location; completed?: boolean; booking_id?: string | null };
type ChecklistItem = { id: string; trip_id: string; text: string; checked: boolean; position: number; created_at: string };

type BookingType = "flight" | "hotel" | "transport" | "ticket";
type Booking = {
  id: string; trip_id: string; type: BookingType; title: string;
  start_date: string | null; start_time: string | null;
  end_date: string | null; end_time: string | null;
  link: string | null; memo: string | null;
  provider: string | null; booking_ref: string | null;
  created_at: string;
};
type BookingFile = { id: string; booking_id: string; trip_id: string; name: string; url: string; mime: string; created_at: string };
type Schedules = Record<string, Event[]>;
type CityStay = { name: string; startDate: string; endDate: string };
type TripInfo = {
  title: string; startDate: string; endDate: string;
  departure: string; returnFlight: string;
  hotel: string; route: string[];
  currency: string;
  exchangeRates?: Record<string, number>;
};
type Trip = { id: string; info: TripInfo; schedules: Schedules; cityStays: CityStay[] };

type EventRecord = {
  id: string;
  trip_id: string;
  event_id: string;
  type: "memo" | "photo";
  content: string;
  user_id: string;
  nickname: string;
  created_at: string;
};

type ExpenseCategory = "food" | "transport" | "stay" | "activity" | "shopping" | "other";

type Expense = {
  id: string;
  trip_id: string;
  expense_date: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  memo: string | null;
  event_id: string | null;
  user_id: string;
  nickname: string | null;
  payer: string | null;          // 지불자
  is_shared: boolean;            // 공동경비 여부
  participants: string[];        // 참여자 목록
  created_at: string;
};

// "text": 사용자 추가 자유 문단
// "event_title_override": 이벤트 제목 수정 (원본 일정 불변)
// "photo_caption": 사진 캡션
type DiaryBlockType = "text" | "event_title_override" | "photo_caption" | "image";

// 문단 추가 anchor
type AddCtx = { eventId: string | null; date: string };

type DiaryBlock = {
  id: string;
  diary_id: string;
  trip_id: string;
  type: DiaryBlockType;
  position: number;
  content: string | null;
  photo_url: string | null;
  author: string | null;
  caption: string | null;
  block_date: string | null;
  event_time: string | null;
  event_title: string | null;
  source_record_id: string | null;
  created_at: string;
  updated_at: string;
};

type TravelDiary = {
  id: string;
  trip_id: string;
  title: string;
  created_by: string;
  created_at: string;
};

// ── Styles ────────────────────────────────────────────────────────────────────

const tagStyle: Record<string, string> = {
  flight:   "bg-stone-100 text-stone-500 border border-stone-200",
  stay:     "bg-stone-100 text-stone-500 border border-stone-200",
  activity: "bg-stone-100 text-stone-500 border border-stone-200",
  food:     "bg-stone-100 text-stone-500 border border-stone-200",
  transit:  "bg-stone-100 text-stone-500 border border-stone-200",
};

const dotStyle: Record<string, string> = {
  flight:   "bg-stone-700",
  stay:     "bg-stone-500",
  activity: "bg-stone-400",
  food:     "bg-stone-600",
  transit:  "bg-stone-300",
};

const tagLabel: Record<string, string> = {
  flight: "항공편", stay: "숙박", activity: "활동", food: "식사", transit: "이동",
};

const tagEmoji: Record<string, string> = {
  // 기존 태그
  flight:   "✈️",
  stay:     "🏨",
  activity: "📍",
  food:     "🍽️",
  transit:  "🚌",
  // 신규 태그
  train:       "🚆",
  bus:         "🚌",
  hotel:       "🏨",
  sightseeing: "📍",
  restaurant:  "🍽️",
  cafe:        "☕",
  shopping:    "🛍️",
  other:       "📝",
};


const INITIAL_CITY_STAYS: { name: string; startDate: string; endDate: string }[] = [];

// ── Component ─────────────────────────────────────────────────────────────────

type Editing = { e: number } | null;

function ensureEventIds(schedules: Schedules): Schedules {
  return Object.fromEntries(
    Object.entries(schedules).map(([date, events]) => [
      date,
      events.map(ev => ev.id ? ev : { ...ev, id: crypto.randomUUID() }),
    ])
  );
}

function formatBlockDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${m}월 ${d}일 ${DAY_LABELS[new Date(y, m - 1, d).getDay()]}`;
}

function getDatesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  let d = new Date(startDate);
  const end = new Date(endDate);
  while (d <= end) {
    dates.push(dateKey(d.getFullYear(), d.getMonth(), d.getDate()));
    d = new Date(d.getTime() + 86400000);
  }
  return dates;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}일 전`;
  if (h > 0) return `${h}시간 전`;
  if (m > 0) return `${m}분 전`;
  return "방금";
}

function mapsDirectionsUrl(from: Location, to: Location) {
  const base = "https://www.google.com/maps/dir/?api=1";
  const origin = from.place_id
    ? `&origin=${encodeURIComponent(from.name)}&origin_place_id=${from.place_id}`
    : `&origin=${encodeURIComponent(from.name)}`;
  const destination = to.place_id
    ? `&destination=${encodeURIComponent(to.name)}&destination_place_id=${to.place_id}`
    : `&destination=${encodeURIComponent(to.name)}`;
  return base + origin + destination;
}

// ─────────────────────────────────────────────────────────────────────────────

function PlaceSearch({ value, onSelect, onClear }: {
  value?: Location;
  onSelect: (loc: Location) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [preds, setPreds] = useState<{ place_id: string; main: string; secondary: string }[]>([]);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => { setQuery(value?.name ?? ""); }, [value?.name]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (
        wrapRef.current && !wrapRef.current.contains(e.target as Node) &&
        (!listRef.current || !listRef.current.contains(e.target as Node))
      ) setPreds([]);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function updatePos() {
    if (wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
    }
  }

  useEffect(() => {
    if (preds.length === 0) { setDropdownPos(null); return; }
    updatePos();
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preds.length]);

  function search(input: string) {
    setQuery(input);
    if (!input.trim()) { setPreds([]); if (!input) onClear(); return; }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).google;
      console.log("[places] search:", JSON.stringify(input), "| window.google:", !!g, "| maps:", !!g?.maps, "| places:", !!g?.maps?.places);
      if (!g?.maps?.places) {
        console.warn("[places] ❌ google.maps.places not available — API not loaded yet");
        return;
      }
      console.log("[places] calling AutocompleteService.getPlacePredictions...");
      new g.maps.places.AutocompleteService().getPlacePredictions(
        { input },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (results: any[], status: string) => {
          console.log("[places] autocomplete status:", status, "| results:", results?.length ?? 0);
          if (status === "OK" && results) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setPreds(results.map((r: any) => ({
              place_id: r.place_id,
              main: r.structured_formatting?.main_text ?? r.description,
              secondary: r.structured_formatting?.secondary_text ?? "",
            })));
          } else {
            if (status !== "ZERO_RESULTS") console.warn("[places] ❌ autocomplete error status:", status);
            setPreds([]);
          }
        }
      );
    }, 300);
  }

  function pick(placeId: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google;
    console.log("[places] pick:", placeId, "| places:", !!g?.maps?.places);
    if (!g?.maps?.places) return;
    new g.maps.places.PlacesService(document.createElement("div")).getDetails(
      { placeId, fields: ["place_id", "name", "geometry"] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (place: any, status: string) => {
        console.log("[places] getDetails status:", status, "| name:", place?.name);
        if (status === "OK" && place?.geometry?.location) {
          onSelect({
            place_id: place.place_id,
            name: place.name,
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
          });
          setQuery(place.name);
          setPreds([]);
        } else {
          console.warn("[places] ❌ getDetails failed:", status);
        }
      }
    );
  }

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <input
          style={{ fontSize: 16, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "10px 14px", paddingRight: value ? 34 : 14, outline: "none", background: "#F7F7F5", width: "100%", boxSizing: "border-box" as const, color: "#111", caretColor: "#0A84FF" }}
          placeholder="장소 검색 (선택)"
          value={query}
          onChange={e => search(e.target.value)}
          onKeyDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        />
        {value && (
          <button
            onClick={e => { e.stopPropagation(); onClear(); setQuery(""); setPreds([]); }}
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#bbb", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}
          >×</button>
        )}
      </div>
      {preds.length > 0 && dropdownPos && typeof document !== "undefined" && createPortal(
        <ul
          ref={listRef}
          onClick={e => e.stopPropagation()}
          style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            zIndex: 9999,
            background: "#fff", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
            maxHeight: 180, overflowY: "auto", listStyle: "none", padding: 0, margin: 0,
          }}
        >
          {preds.map(p => (
            <li
              key={p.place_id}
              onClick={e => { e.stopPropagation(); pick(p.place_id); }}
              className="hover:bg-stone-50"
              style={{ padding: "7px 12px", fontSize: 12, cursor: "pointer", borderBottom: "1px solid rgba(0,0,0,0.05)" }}
            >
              <span style={{ fontWeight: 500, color: "#222" }}>{p.main}</span>
              {p.secondary && <span style={{ color: "#aaa", marginLeft: 6, fontSize: 11 }}>{p.secondary}</span>}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

function MiniMap({ lat, lng }: { lat: number; lng: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);

  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function tryInit() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).google;
      if (!g?.maps || !containerRef.current) {
        retryTimer = setTimeout(tryInit, 500);
        return;
      }
      if (mapRef.current) return;

      const map = new g.maps.Map(containerRef.current, {
        center: { lat, lng },
        zoom: 15,
        disableDefaultUI: true,
        gestureHandling: "none",
        scrollwheel: false,
        draggable: false,
        clickableIcons: false,
      });

      const marker = new g.maps.Marker({ position: { lat, lng }, map });
      mapRef.current = map;
      markerRef.current = marker;
    }

    tryInit();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (markerRef.current) { markerRef.current.setMap(null); markerRef.current = null; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).google?.maps?.event && mapRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).google.maps.event.clearInstanceListeners(mapRef.current);
      }
      mapRef.current = null;
    };
  }, [lat, lng]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

function MapPopover({ location }: { location: Location }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const PW = 240, PH = 150;

  function updatePos() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const left = Math.min(r.left, window.innerWidth - PW - 8);
    const top = r.bottom + 6 + PH > window.innerHeight - 8 ? r.top - PH - 6 : r.bottom + 6;
    setPos({ top, left });
  }

  function scheduleClose() {
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  }
  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (btnRef.current?.contains(e.target as Node) || popoverRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  const mapsUrl = location.place_id
    ? `https://www.google.com/maps/place/?q=place_id:${location.place_id}`
    : `https://maps.google.com/?q=${location.lat},${location.lng}`;

  return (
    <>
      <button
        ref={btnRef}
        title="지도 보기"
        onMouseEnter={() => { cancelClose(); updatePos(); setOpen(true); }}
        onMouseLeave={scheduleClose}
        onClick={e => { e.stopPropagation(); open ? setOpen(false) : (updatePos(), setOpen(true)); }}
        style={{ fontSize: 13, lineHeight: 1, background: "none", border: "none", cursor: "pointer", padding: "0 2px", flexShrink: 0, opacity: 0.7 }}
      >🗺️</button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          onClick={() => window.open(mapsUrl, "_blank")}
          style={{
            position: "fixed", top: pos.top, left: pos.left,
            width: PW, height: PH, zIndex: 9999,
            borderRadius: 8, overflow: "hidden", cursor: "pointer",
            boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
            border: "1px solid rgba(0,0,0,0.1)",
          }}
        >
          <MiniMap lat={location.lat} lng={location.lng} />
        </div>,
        document.body
      )}
    </>
  );
}


function EventRecordsSection({
  records, userId, canEdit, onAddMemo, onDeleteRecord, onUploadPhoto,
}: {
  records: EventRecord[];
  userId: string;
  canEdit: boolean;
  onAddMemo: (content: string) => Promise<void>;
  onDeleteRecord: (id: string) => void;
  onUploadPhoto: (file: File) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<"memo" | "photo" | null>(null);
  const [memoText, setMemoText] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const total = records.length;
  const sorted = [...records].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  if (!canEdit && total === 0) return null;

  const saveBtnStyle: React.CSSProperties = { fontSize: 11, color: "white", background: "#0A84FF", border: "none", borderRadius: 4, padding: "3px 10px", cursor: "pointer" };
  const cancelBtnStyle: React.CSSProperties = { fontSize: 11, color: "#9ca3af", background: "none", border: "none", cursor: "pointer" };
  const addBtnStyle: React.CSSProperties = { fontSize: 11, color: "#b0b8c4", background: "none", border: "none", cursor: "pointer", padding: 0 };

  return (
    <div style={{ padding: "5px 20px 8px 20px", borderTop: "1px dashed rgba(0,0,0,0.06)" }}>
      {/* Toggle button */}
      <button
        onClick={() => { setOpen(o => !o); setAdding(null); }}
        style={{ fontSize: 11, color: open ? "#4b5563" : "#b0b8c4", background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        📖 {total > 0 ? `여행 기록 ${total}개` : "기록 추가"}{total > 0 ? (open ? " ▲" : " ▼") : ""}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {/* Unified record list — newest first */}
          {sorted.map((r, i) => (
            <div key={r.id}>
              {i > 0 && (
                <div style={{ borderTop: "1px dashed rgba(0,0,0,0.07)", margin: "10px 0" }} />
              )}

              {r.type === "photo" ? (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 10, color: "#9ca3af" }}>
                      📷 사진
                      <span style={{ color: "#d1d5db", margin: "0 4px" }}>·</span>
                      <span style={{ fontWeight: 500, color: "#6b7280" }}>{r.nickname}</span>
                      <span style={{ color: "#d1d5db", margin: "0 4px" }}>·</span>
                      {timeAgo(r.created_at)}
                    </span>
                    {r.user_id === userId && (
                      <button onClick={() => onDeleteRecord(r.id)} style={{ fontSize: 11, color: "#d1d5db", background: "none", border: "none", cursor: "pointer", lineHeight: 1 }}>×</button>
                    )}
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.content}
                    alt=""
                    style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 8, display: "block", cursor: "pointer" }}
                    onClick={() => { /* 사진 확대: onPhotoClick(r.content) */ }}
                  />
                </div>
              ) : (
                <div>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6 }}>
                    <p style={{ fontSize: 12, color: "#374151", margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap", flex: 1 }}>{r.content}</p>
                    {r.user_id === userId && (
                      <button onClick={() => onDeleteRecord(r.id)} style={{ fontSize: 11, color: "#d1d5db", background: "none", border: "none", cursor: "pointer", lineHeight: 1, flexShrink: 0, marginTop: 2 }}>×</button>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 3 }}>
                    <span style={{ fontWeight: 500, color: "#6b7280" }}>{r.nickname}</span>
                    {" · "}
                    {timeAgo(r.created_at)}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Add buttons */}
          {canEdit && adding === null && (
            <div style={{ display: "flex", gap: 10, marginTop: total > 0 ? 12 : 0, borderTop: total > 0 ? "1px dashed rgba(0,0,0,0.06)" : undefined, paddingTop: total > 0 ? 8 : 0 }}>
              <button
                style={addBtnStyle}
                onMouseEnter={e => (e.currentTarget.style.color = "#6b7280")}
                onMouseLeave={e => (e.currentTarget.style.color = "#b0b8c4")}
                onClick={() => setAdding("memo")}
              >📝 메모</button>
              <button
                style={addBtnStyle}
                onMouseEnter={e => (e.currentTarget.style.color = "#6b7280")}
                onMouseLeave={e => (e.currentTarget.style.color = "#b0b8c4")}
                onClick={() => { setPhotoFile(null); setAdding("photo"); }}
              >📷 사진</button>
            </div>
          )}

          {/* Memo form */}
          {adding === "memo" && (
            <div style={{ marginTop: total > 0 ? 12 : 0 }}>
              <textarea
                autoFocus
                value={memoText}
                onChange={e => setMemoText(e.target.value)}
                placeholder="메모를 입력하세요"
                rows={2}
                style={{ width: "100%", fontSize: 12, border: "1px solid #e5e7eb", borderRadius: 6, padding: "6px 8px", resize: "none", outline: "none", boxSizing: "border-box", fontFamily: "inherit" }}
              />
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button style={saveBtnStyle} onClick={async () => { if (!memoText.trim()) return; await onAddMemo(memoText.trim()); setMemoText(""); setAdding(null); }}>저장</button>
                <button style={cancelBtnStyle} onClick={() => { setMemoText(""); setAdding(null); }}>취소</button>
              </div>
            </div>
          )}

          {/* Photo form */}
          {adding === "photo" && (
            <div style={{ marginTop: total > 0 ? 12 : 0 }}>
              <input type="file" accept="image/*" onChange={e => setPhotoFile(e.target.files?.[0] ?? null)} style={{ fontSize: 11 }} />
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                <button
                  disabled={!photoFile || uploading}
                  style={{ ...saveBtnStyle, background: !photoFile || uploading ? "#9ca3af" : "#0A84FF", cursor: !photoFile || uploading ? "default" : "pointer" }}
                  onClick={async () => {
                    if (!photoFile) return;
                    setUploading(true);
                    try { await onUploadPhoto(photoFile); setPhotoFile(null); setAdding(null); }
                    finally { setUploading(false); }
                  }}
                >{uploading ? "업로드 중…" : "저장"}</button>
                <button style={cancelBtnStyle} onClick={() => { setPhotoFile(null); setAdding(null); }}>취소</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SortableEventRow({ id, ev, isEditing, nextLocation, onSelect, onConfirm, onCancel, onDelete,
  records, userId, canEdit, onAddMemo, onDeleteRecord, onUploadPhoto, onToggleComplete,
  bookings, bookingFiles, onOpenLightbox, onGoToBooking,
}: {
  id: string; ev: Event; isEditing: boolean; nextLocation?: Location;
  onSelect: () => void;
  onConfirm: (updated: Event) => void;
  onCancel: () => void;
  onDelete: () => void;
  records: EventRecord[];
  userId: string;
  canEdit: boolean;
  onAddMemo: (content: string) => Promise<void>;
  onDeleteRecord: (id: string) => void;
  onUploadPhoto: (file: File) => Promise<void>;
  onToggleComplete: () => void;
  bookings: Booking[];
  bookingFiles: BookingFile[];
  onOpenLightbox: (url: string) => void;
  onGoToBooking: (bookingId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const [draft, setDraft] = useState<Event>(ev);

  useEffect(() => {
    if (isEditing) setDraft(ev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      {...attributes}
    >
      <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-stone-50/50 transition-colors">
      <span
        className="text-stone-200 shrink-0 cursor-grab active:cursor-grabbing select-none text-sm leading-none"
        style={{ touchAction: "none" }}
        onClick={e => e.stopPropagation()}
        {...listeners}
      >⠿</span>
      {/* 체크박스 — 수정 모드에서는 숨김 */}
      {!isEditing && (
        <button
          onClick={e => { e.stopPropagation(); if (canEdit) onToggleComplete(); }}
          style={{
            width: 16, height: 16, borderRadius: 3, flexShrink: 0,
            border: ev.completed ? "none" : "1.5px solid #d1d5db",
            background: ev.completed ? "#34C759" : "transparent",
            cursor: canEdit ? "pointer" : "default",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 150ms, border 150ms",
          }}
        >
          {ev.completed && <span style={{ color: "#fff", fontSize: 9, lineHeight: 1, fontWeight: 700 }}>✓</span>}
        </button>
      )}
      {isEditing ? (
        <input
          className="text-xs font-mono w-12 shrink-0 border border-stone-300 rounded px-1 py-0.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-stone-300"
          value={draft.time}
          onChange={e => setDraft(d => ({ ...d, time: e.target.value }))}
          onKeyDown={e => { e.stopPropagation(); if (e.key === "Escape") onCancel(); }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <span className="text-[11px] font-mono tabular-nums w-10 shrink-0 transition-opacity" style={{ color: ev.completed ? "#34C759" : "#a8a29e", opacity: ev.completed ? 0.7 : 1 }}>{ev.time}</span>
      )}
      <div className="w-px self-stretch bg-stone-100 shrink-0" />
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <>
            <input
              className="text-sm font-medium text-slate-800 w-full border border-stone-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-stone-300"
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Enter") onConfirm(draft);
                if (e.key === "Escape") onCancel();
              }}
              onClick={e => e.stopPropagation()}
              autoFocus
            />
            <div className="mt-1.5" onClick={e => e.stopPropagation()}>
              <PlaceSearch
                value={draft.location}
                onSelect={loc => setDraft(d => ({ ...d, location: loc }))}
                onClear={() => setDraft(d => ({ ...d, location: undefined }))}
              />
            </div>
            {bookings.length > 0 && (
              <div className="mt-1.5" onClick={e => e.stopPropagation()}>
                <select
                  className="w-full text-xs border border-stone-300 rounded px-1 py-0.5 bg-white focus:outline-none"
                  value={draft.booking_id ?? ""}
                  onChange={e => { e.stopPropagation(); setDraft(d => ({ ...d, booking_id: e.target.value || null })); }}
                  onClick={e => e.stopPropagation()}
                >
                  <option value="">── 예약 연결 없음</option>
                  {[...bookings].sort((a, b) => (a.start_date ?? "zzz").localeCompare(b.start_date ?? "zzz")).map(b => (
                    <option key={b.id} value={b.id}>
                      {BOOKING_TYPE_CFG[b.type].emoji} {b.title}{b.start_date ? ` · ${fmtBookingDate(b.start_date)}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm font-medium truncate" style={{
            color: ev.completed ? "#9ca3af" : "#1c1917",
            textDecoration: ev.completed ? "line-through" : "none",
            textDecorationColor: "#9ca3af",
          }}>
            {tagEmoji[ev.tag] && `${tagEmoji[ev.tag]} `}{ev.title}
          </p>
        )}
        {/* 연결된 예약 뱃지 */}
        {!isEditing && ev.booking_id && (() => {
          const bk = bookings.find(b => b.id === ev.booking_id);
          if (!bk) return null;
          const bkFiles = bookingFiles.filter(f => f.booking_id === bk.id);
          const cfg = BOOKING_TYPE_CFG[bk.type];
          return (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
              <button
                onClick={e => { e.stopPropagation(); onGoToBooking(bk.id); }}
                style={{ fontSize: 10, color: "#059669", background: "rgba(10,132,255,0.07)", border: "1px solid rgba(10,132,255,0.3)", borderRadius: 5, padding: "2px 7px", display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer", fontFamily: "inherit" }}
              >
                {cfg.emoji} {bk.title} ↗
              </button>
              {bk.link && (
                <button onClick={e => { e.stopPropagation(); window.open(bk.link!, "_blank"); }}
                  style={{ fontSize: 11, color: "#059669", background: "none", border: "none", cursor: "pointer", padding: "1px 3px", lineHeight: 1 }}>🔗</button>
              )}
              {bkFiles.map(f => (
                <button key={f.id}
                  onClick={e => { e.stopPropagation(); f.mime.startsWith("image/") ? onOpenLightbox(f.url) : window.open(f.url, "_blank"); }}
                  style={{ fontSize: 11, color: "#059669", background: "none", border: "none", cursor: "pointer", padding: "1px 3px", lineHeight: 1 }}>
                  {f.mime.startsWith("image/") ? "🖼️" : "📄"}
                </button>
              ))}
            </div>
          );
        })()}
        {!isEditing && ev.location && (
          <div className="flex items-center gap-1 mt-0.5 min-w-0">
            <p className="text-xs text-stone-400 truncate">📍 {ev.location.name}</p>
            <MapPopover location={ev.location} />
          </div>
        )}
        {ev.detail && <p className="text-xs text-stone-400 truncate mt-0.5">{ev.detail}</p>}
      </div>
      {isEditing ? (
        <select
          className="text-[10px] border border-stone-300 rounded px-1 py-0.5 bg-white text-slate-600 focus:outline-none shrink-0"
          value={draft.tag}
          onChange={e => { e.stopPropagation(); setDraft(d => ({ ...d, tag: e.target.value })); }}
          onClick={e => e.stopPropagation()}
        >
          {Object.keys(tagLabel).map(t => <option key={t} value={t}>{tagLabel[t]}</option>)}
        </select>
      ) : (
        <span className="text-[9px] uppercase tracking-widest text-stone-300 shrink-0 hidden sm:block">
          {tagLabel[ev.tag]}
        </span>
      )}
      {isEditing ? (
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            className="text-[10px] text-white bg-[#0A84FF] rounded px-2 py-1 hover:bg-[#0071e3] transition-colors"
            onClick={e => { e.stopPropagation(); onConfirm(draft); }}
          >확인</button>
          <button
            className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors px-1.5 py-1"
            onClick={e => { e.stopPropagation(); onCancel(); }}
          >취소</button>
          <button
            className="shrink-0 text-slate-300 hover:text-red-400 transition-colors text-base leading-none"
            onClick={e => { e.stopPropagation(); onDelete(); }}
          >×</button>
        </div>
      ) : (
        <button
          className="text-[10px] text-stone-400 hover:text-stone-600 border border-stone-200 rounded px-2 py-1 shrink-0 transition-colors"
          onClick={e => { e.stopPropagation(); onSelect(); }}
        >수정</button>
      )}
      </div>
      {!isEditing && !isDragging && (
        <EventRecordsSection
          records={records}
          userId={userId}
          canEdit={canEdit}
          onAddMemo={onAddMemo}
          onDeleteRecord={onDeleteRecord}
          onUploadPhoto={onUploadPhoto}
        />
      )}
      {!isEditing && !isDragging && ev.location && nextLocation && (
        <div style={{ padding: "2px 20px 6px 20px" }}>
          <button
            onClick={e => { e.stopPropagation(); window.open(mapsDirectionsUrl(ev.location!, nextLocation), "_blank"); }}
            style={{ fontSize: 11, color: "#b0b8c4", background: "none", border: "none", cursor: "pointer", padding: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = "#6b7280")}
            onMouseLeave={e => (e.currentTarget.style.color = "#b0b8c4")}
          >🧭 길찾기</button>
        </div>
      )}
    </div>
  );
}

function RouteMapModal({ events, onClose }: { events: Event[]; onClose: () => void }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersRef = useRef<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const boundsRef = useRef<any>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  const located = events
    .filter(e => e.location)
    .map(e => ({ title: e.title, time: e.time, ...e.location! }));

  // These functions use only refs and stable setters — safe to call from stale closures
  function focusLocation(idx: number) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google;
    if (!mapRef.current || !g?.maps) return;
    const loc = located[idx];
    mapRef.current.panTo({ lat: loc.lat, lng: loc.lng });
    mapRef.current.setZoom(15);
    markersRef.current.forEach(m => m.setAnimation(null));
    markersRef.current[idx]?.setAnimation(g.maps.Animation.BOUNCE);
    setSelectedIdx(idx);
  }

  function viewAll() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = (window as any).google;
    if (!mapRef.current || !g?.maps) return;
    markersRef.current.forEach(m => m.setAnimation(null));
    if (located.length === 1) {
      mapRef.current.setCenter({ lat: located[0].lat, lng: located[0].lng });
      mapRef.current.setZoom(15);
    } else if (boundsRef.current) {
      mapRef.current.fitBounds(boundsRef.current, 48);
    }
    setSelectedIdx(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (located.length === 0) return;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    function tryInit() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = (window as any).google;
      if (!g?.maps || !mapContainerRef.current) {
        retryTimer = setTimeout(tryInit, 500);
        return;
      }
      if (mapRef.current) return;

      const map = new g.maps.Map(mapContainerRef.current, {
        zoom: 13,
        center: { lat: located[0].lat, lng: located[0].lng },
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });

      const bounds = new g.maps.LatLngBounds();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const markers: any[] = [];

      located.forEach((loc, i) => {
        const pos = { lat: loc.lat, lng: loc.lng };
        bounds.extend(pos);
        const marker = new g.maps.Marker({
          position: pos, map,
          label: { text: String(i + 1), color: "#fff", fontSize: "11px", fontWeight: "bold" },
          title: loc.name,
        });
        marker.addListener("click", () => focusLocation(i));
        markers.push(marker);
      });

      if (located.length > 1) {
        new g.maps.Polyline({
          path: located.map(l => ({ lat: l.lat, lng: l.lng })),
          geodesic: true,
          strokeColor: "#0A84FF",
          strokeOpacity: 0.75,
          strokeWeight: 2.5,
          map,
        });
        map.fitBounds(bounds, 48);
      } else {
        map.setCenter({ lat: located[0].lat, lng: located[0].lng });
        map.setZoom(15);
      }

      mapRef.current = map;
      markersRef.current = markers;
      boundsRef.current = bounds;
    }

    tryInit();

    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).google?.maps?.event && mapRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).google.maps.event.clearInstanceListeners(mapRef.current);
      }
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 14,
          boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
          width: "100%", maxWidth: 560,
          maxHeight: "88vh",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 20px 12px", borderBottom: "1px solid rgba(0,0,0,0.07)", flexShrink: 0,
        }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", margin: 0 }}>🗺️ 오늘 동선</p>
          <button
            onClick={onClose}
            style={{ fontSize: 22, color: "#bbb", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: 0 }}
          >×</button>
        </div>

        {located.length === 0 ? (
          <p style={{ padding: "40px 20px", textAlign: "center", color: "#aaa", fontSize: 13, margin: 0 }}>
            장소가 등록된 일정이 없습니다.
          </p>
        ) : (
          <>
            <div ref={mapContainerRef} style={{ height: 320, flexShrink: 0 }} />
            <div style={{ overflowY: "auto", padding: "8px 20px 20px" }}>
              {/* 전체 보기 */}
              {located.length > 1 && (
                <div style={{ display: "flex", justifyContent: "flex-end", paddingBottom: 4 }}>
                  <button
                    onClick={viewAll}
                    style={{
                      fontSize: 11, background: "none", border: "none", cursor: "pointer", padding: "2px 0",
                      color: selectedIdx !== null ? "#0A84FF" : "#ccc",
                      transition: "color 150ms",
                    }}
                  >전체 동선 보기</button>
                </div>
              )}
              {located.map((loc, i) => {
                const isSel = selectedIdx === i;
                return (
                  <div
                    key={i}
                    onClick={() => focusLocation(i)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "7px 8px", margin: "0 -8px",
                      borderRadius: 8,
                      borderBottom: i < located.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none",
                      cursor: "pointer",
                      background: isSel ? "rgba(10,132,255,0.07)" : "transparent",
                      transition: "background 150ms",
                    }}
                  >
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: "#fff",
                      background: isSel ? "#0071e3" : "#0A84FF",
                      borderRadius: "50%",
                      width: isSel ? 22 : 20, height: isSel ? 22 : 20,
                      flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: isSel ? "0 2px 8px rgba(10,132,255,0.35)" : "none",
                      transition: "all 150ms",
                    }}>{i + 1}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{
                        fontSize: 13, margin: 0,
                        fontWeight: isSel ? 600 : 500,
                        color: isSel ? "#1a1a1a" : "#333",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}>{loc.name}</p>
                      <p style={{ fontSize: 11, color: "#aaa", margin: "1px 0 0" }}>{loc.time} · {loc.title}</p>
                    </div>
                    {isSel && <span style={{ fontSize: 10, color: "#0A84FF", flexShrink: 0 }}>▶</span>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

// 정산 계산: 순 이체 최소화 알고리즘
type Settlement = { currency: string; from: string; to: string; amount: number };
function computeSettlements(expenses: Expense[]): Settlement[] {
  const byC: Record<string, { paid: Record<string, number>; owed: Record<string, number> }> = {};
  for (const e of expenses) {
    const cur = e.currency;
    if (!byC[cur]) byC[cur] = { paid: {}, owed: {} };
    const payer = e.payer || "?";
    const amount = Number(e.amount);
    byC[cur].paid[payer] = (byC[cur].paid[payer] || 0) + amount;
    const ps = e.is_shared && e.participants?.length > 0 ? e.participants : [payer];
    const share = amount / ps.length;
    for (const p of ps) byC[cur].owed[p] = (byC[cur].owed[p] || 0) + share;
  }
  const results: Settlement[] = [];
  for (const [currency, { paid, owed }] of Object.entries(byC)) {
    const people = new Set([...Object.keys(paid), ...Object.keys(owed)]);
    const net: Record<string, number> = {};
    for (const p of people) net[p] = (paid[p] || 0) - (owed[p] || 0);
    const pos = Object.entries(net).filter(([, n]) => n > 0.005).map(([p, n]) => ({ p, n })).sort((a, b) => b.n - a.n);
    const neg = Object.entries(net).filter(([, n]) => n < -0.005).map(([p, n]) => ({ p, n: -n })).sort((a, b) => b.n - a.n);
    while (pos.length && neg.length) {
      const c = pos[0], d = neg[0];
      const t = Math.min(c.n, d.n);
      if (t > 0.005) results.push({ currency, from: d.p, to: c.p, amount: Math.round(t * 100) / 100 });
      c.n -= t; d.n -= t;
      if (c.n < 0.005) pos.shift();
      if (d.n < 0.005) neg.shift();
    }
  }
  return results;
}

function fmtBookingDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dow = ["일","월","화","수","목","금","토"][new Date(y, m - 1, day).getDay()];
  return `${m}월 ${day}일 (${dow})`;
}

function fmtBookingRange(b: Booking): string {
  if (!b.start_date && !b.start_time) return "";
  const parts: string[] = [];
  if (b.start_date) parts.push(fmtBookingDate(b.start_date));
  if (b.start_time) parts.push(b.start_time);
  if (b.end_date && b.end_date !== b.start_date) {
    parts.push("~"); parts.push(fmtBookingDate(b.end_date));
    if (b.end_time) parts.push(b.end_time);
  } else if (b.end_time) {
    parts.push("~"); parts.push(b.end_time);
  }
  return parts.join(" ");
}

function extractStoragePath(url: string, bucket: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  return idx >= 0 ? url.slice(idx + marker.length) : null;
}

export default function Home() {
  const [view,         setView]         = useState<"home" | "planner" | "diary">("home");
  const [trips,        setTrips]        = useState<Trip[]>([]);
  const [currentTripId, setCurrentTripId] = useState<string | null>(null);
  const [schedules,    setSchedules]    = useState<Schedules>({});
  const [tripInfo,     setTripInfo]     = useState<TripInfo>(INITIAL_TRIP);
  const [editingTrip,  setEditingTrip]  = useState(false);
  const [cityStays,    setCityStays]    = useState(INITIAL_CITY_STAYS);
  const [editing,      setEditing]      = useState<Editing>(null);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [viewYear,  setViewYear]  = useState(TODAY.year);
  const [viewMonth, setViewMonth] = useState(TODAY.month);
  const [showForm,  setShowForm]  = useState(false);
  const [showRouteMap, setShowRouteMap] = useState(false);
  const [copiedTripId, setCopiedTripId] = useState<string | null>(null);
  const [form, setForm] = useState<{ time: string; title: string; tag: string; location?: Location; booking_id: string }>({ time: "09:00", title: "", tag: "activity", booking_id: "" });
  const [cityForm, setCityForm] = useState({ name: "", startDate: "", endDate: "" });
  const [showCityForm, setShowCityForm] = useState(false);
  const [showTripPanel, setShowTripPanel] = useState(false);
  const [showEditEventSheet, setShowEditEventSheet] = useState(false);
  const [editEventIdx, setEditEventIdx] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<{ time: string; title: string; tag: string; location?: Location; booking_id: string }>({ time: "09:00", title: "", tag: "activity", booking_id: "" });
  const [hoveredWindow, setHoveredWindow] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [nicknameInput, setNicknameInput] = useState("");
  const [showNicknamePrompt, setShowNicknamePrompt] = useState(false);
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameEditValue, setNicknameEditValue] = useState("");
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  // Hydration-safe localStorage: load once after mount, then save on changes.
  const canSave = useRef(false);
  const currentTripIdRef = useRef<string | null>(null);
  const ownerIdRef = useRef<string>("");
  const ownedTripIdsRef = useRef<Set<string>>(new Set());
  const tripRolesRef = useRef<Map<string, string>>(new Map());
  const isApplyingRealtimeRef = useRef(false);
  const [isMemberOfCurrentTrip, setIsMemberOfCurrentTrip] = useState(true);
  const [currentUserRole, setCurrentUserRole] = useState<string>("owner");
  const [members, setMembers] = useState<{ member_id: string; role: string; nickname?: string }[]>([]);
  const [eventRecords, setEventRecords] = useState<EventRecord[]>([]);

  // 탭
  const [plannerTab, setPlannerTab] = useState<"plan" | "checklist" | "bookings" | "expenses">("plan");
  const [expenseView, setExpenseView] = useState<"all" | "category" | "person" | "currency" | "settle">("all");
  const [showRatePanel, setShowRatePanel] = useState(false);

  // 체크리스트
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>([]);
  const [checklistNewText, setChecklistNewText] = useState("");
  const checklistTemplateInsertedRef = useRef<Set<string>>(new Set());

  // 예약 관리
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingFiles, setBookingFiles] = useState<BookingFile[]>([]);
  const [bookingView, setBookingView] = useState<"date" | "category">("date");
  const [bookingFilter, setBookingFilter] = useState<"all" | BookingType>("all");
  const [expandedBookingId, setExpandedBookingId] = useState<string | null>(null);
  const [showBookingSheet, setShowBookingSheet] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [bookingForm, setBookingForm] = useState(BOOKING_FORM_INIT);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [uploadingBookingId, setUploadingBookingId] = useState<string | null>(null);

  // 경비 state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [addingExpenseDate, setAddingExpenseDate] = useState<string | null>(null);
  const [expenseForm, setExpenseForm] = useState({ amount: "", currency: "KRW", category: "other", memo: "", event_id: "", payer: "", is_shared: false, participants: [] as string[] });
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editExpenseForm, setEditExpenseForm] = useState({ amount: "", currency: "KRW", category: "other", memo: "", event_id: "", payer: "", is_shared: false, participants: [] as string[] });
  const [showExpenseSheet, setShowExpenseSheet] = useState(false);
  const [expenseFormDate, setExpenseFormDate] = useState("");
  const [newRateCur, setNewRateCur] = useState("");
  const [newRateVal, setNewRateVal] = useState("");

  // Diary state
  const [currentDiary, setCurrentDiary] = useState<TravelDiary | null>(null);
  const [diaryBlocks, setDiaryBlocks] = useState<DiaryBlock[]>([]);
  const [diaryLoading, setDiaryLoading] = useState(false);
  const [diaryEditMode, setDiaryEditMode] = useState(false);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);   // diary_block.id (text 블록 수정)
  const [editingBlockValue, setEditingBlockValue] = useState("");
  const [editingEventId, setEditingEventId] = useState<string | null>(null);   // event.id (제목 override)
  const [editingEventValue, setEditingEventValue] = useState("");
  const [addingInContext, setAddingInContext] = useState<AddCtx | null>(null); // 문단 추가 anchor
  const [newBlockText, setNewBlockText] = useState("");
  const [addingImageContext, setAddingImageContext] = useState<AddCtx | null>(null);
  const [uploadingDiaryImage, setUploadingDiaryImage] = useState(false);
  const [editingCaptionId, setEditingCaptionId] = useState<string | null>(null); // event_record.id (캡션)
  const [captionValue, setCaptionValue] = useState("");
  const [editingDiaryTitle, setEditingDiaryTitle] = useState(false);
  const [diaryTitleValue, setDiaryTitleValue] = useState("");
  const currentDiaryIdRef = useRef<string | null>(null);

  useEffect(() => {
    async function load() {
      const ownerId = (() => {
        let id = localStorage.getItem("travel-owner-id");
        if (!id) { id = crypto.randomUUID(); localStorage.setItem("travel-owner-id", id); }
        return id;
      })();
      ownerIdRef.current = ownerId;

      const migrateIds = (ts: Trip[]) =>
        ts.map(t => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t.id)
          ? t : { ...t, id: crypto.randomUUID() });
      let loaded: Trip[] = [];
      try {
        const { data, error } = await supabase
          .from("trip_members")
          .select("role, trips(data)")
          .eq("member_id", ownerId);
        if (!error && data && data.length > 0) {
          const rows = data as unknown as { role: string; trips: { data: Trip } }[];
          loaded = migrateIds(rows.map(r => r.trips.data));
          console.log("[currency] after load — currencies:", loaded.map(t => ({ id: t.id.slice(0, 8), currency: t.info.currency })));
          ownedTripIdsRef.current = new Set(
            rows.filter(r => r.role === "owner").map(r => r.trips.data.id)
          );
          tripRolesRef.current = new Map(rows.map(r => [r.trips.data.id, r.role]));
        } else {
          const saved = localStorage.getItem("travel-trips");
          if (saved) loaded = migrateIds(JSON.parse(saved));
        }
      } catch {
        const saved = localStorage.getItem("travel-trips");
        if (saved) loaded = migrateIds(JSON.parse(saved));
      }
      setTrips(loaded);
      canSave.current = true;

      const urlTripId = new URLSearchParams(window.location.search).get("trip");
      console.log("[share] trip param:", urlTripId ?? "(none)");
      if (urlTripId) {
        const alreadyMember = loaded.find(t => t.id === urlTripId);
        if (alreadyMember) {
          console.log("[share] trip found in local trips — opening directly");
          openTrip(alreadyMember);
        } else {
          console.log("[share] loading trip from Supabase:", urlTripId);
          const { data, error } = await supabase.from("trips").select("data").eq("id", urlTripId).single();
          console.log("[share] supabase result — data:", !!data, "error:", error ? `${error.code} ${error.message}` : null);
          if (data) {
            console.log("[share] trip found — opening");
            openTrip((data as { data: Trip }).data, false);
          } else {
            console.warn("[share] trip not found — staying on home. error:", error);
          }
        }
      } else {
        const lastView = localStorage.getItem("lastView");
        const lastTripId = localStorage.getItem("lastTripId");
        if (lastView === "planner" && lastTripId) {
          const lastTrip = loaded.find(t => t.id === lastTripId);
          if (lastTrip) openTrip(lastTrip);
        }
      }
    }
    load();
  }, []);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    console.log("[maps] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY present:", !!apiKey);
    console.log("[maps] window.google:", w.google);
    console.log("[maps] window.google?.maps:", w.google?.maps);
    console.log("[maps] window.google?.maps?.places:", w.google?.maps?.places);
    if (!apiKey) { console.error("[maps] ❌ API key missing"); return; }
    if (w.google?.maps) { console.log("[maps] already loaded, skipping script inject"); return; }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
    script.async = true;
    script.onload = () => {
      console.log("[maps] ✅ script loaded");
      console.log("[maps] window.google:", w.google);
      console.log("[maps] window.google.maps.places:", w.google?.maps?.places);
    };
    script.onerror = (e) => console.error("[maps] ❌ script failed to load", e);
    document.head.appendChild(script);
    console.log("[maps] script tag injected:", script.src);
  }, []);

  // Persist trips array
  useEffect(() => {
    if (!canSave.current) return;
    if (isApplyingRealtimeRef.current) return;
    localStorage.setItem("travel-trips", JSON.stringify(trips));
    const timer = setTimeout(async () => {
      const ownedTrips = trips.filter(t => ownedTripIdsRef.current.has(t.id));
      const editorTrips = trips.filter(t =>
        !ownedTripIdsRef.current.has(t.id) && tripRolesRef.current.get(t.id) !== "viewer"
      );
      if (ownedTrips.length > 0) {
        console.log("[currency] before save — currencies:", ownedTrips.map(t => ({ id: t.id.slice(0, 8), currency: t.info.currency })));
        const { error: upsertErr } = await supabase.from("trips").upsert(
          ownedTrips.map(t => ({
            id: t.id,
            title: t.info.title,
            start_date: t.info.startDate || null,
            end_date: t.info.endDate || null,
            owner_id: ownerIdRef.current,
            data: t,
          })),
          { onConflict: "id" }
        );
        if (upsertErr) console.error("Supabase upsert error:", upsertErr);
        await supabase.from("trip_members").upsert(
          ownedTrips.map(t => ({ trip_id: t.id, member_id: ownerIdRef.current, role: "owner" })),
          { onConflict: "trip_id,member_id" }
        );
      }
      for (const t of editorTrips) {
        await supabase.from("trips").update({
          title: t.info.title,
          start_date: t.info.startDate || null,
          end_date: t.info.endDate || null,
          data: t,
        }).eq("id", t.id);
      }
      // Delete rows no longer in the trips array
      const { data: existing } = await supabase.from("trips").select("id").eq("owner_id", ownerIdRef.current);
      if (existing) {
        const keep = new Set(trips.map(t => t.id));
        const dead = existing.filter((r: { id: string }) => !keep.has(r.id)).map((r: { id: string }) => r.id);
        if (dead.length > 0) {
          const { error: delErr } = await supabase.from("trips").delete().in("id", dead).eq("owner_id", ownerIdRef.current);
          if (delErr) console.error("Supabase delete error:", delErr);
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [trips]);

  // Keep refs in sync
  useEffect(() => { currentTripIdRef.current = currentTripId; }, [currentTripId]);
  useEffect(() => { currentDiaryIdRef.current = currentDiary?.id ?? null; }, [currentDiary]);

  // 통화 변경 추적 — currency가 변경될 때만 로그
  useEffect(() => {
    console.log("[currency] tripInfo.currency changed →", tripInfo.currency ?? "(undefined → fallback KRW)");
  }, [tripInfo.currency]);

  // Load members when opening a trip (planner and diary both need this)
  useEffect(() => {
    if (!currentTripId || (view !== "planner" && view !== "diary")) return;
    supabase.from("trip_members").select("member_id, role, nickname").eq("trip_id", currentTripId)
      .then(({ data }) => { if (data) setMembers(data as { member_id: string; role: string; nickname?: string }[]); });
  }, [currentTripId, view]);

  // Load event records when opening a trip
  useEffect(() => {
    if (!currentTripId || (view !== "planner" && view !== "diary")) { setEventRecords([]); return; }
    supabase.from("event_records").select("*").eq("trip_id", currentTripId).order("created_at")
      .then(({ data }) => { if (data) setEventRecords(data as EventRecord[]); });
  }, [currentTripId, view]);

  // Load checklist items when entering checklist tab
  useEffect(() => {
    if (!currentTripId || view !== "planner" || plannerTab !== "checklist") {
      if (plannerTab !== "checklist") setChecklistItems([]);
      return;
    }
    supabase.from("checklist_items").select("*").eq("trip_id", currentTripId).order("position")
      .then(async ({ data }) => {
        if (data && data.length > 0) {
          setChecklistItems(data as ChecklistItem[]);
        } else if (data && !checklistTemplateInsertedRef.current.has(currentTripId)) {
          // 최초 1회만 기본 템플릿 삽입
          checklistTemplateInsertedRef.current.add(currentTripId);
          const items = CHECKLIST_TEMPLATE.map((text, i) => ({
            trip_id: currentTripId, text, checked: false, position: i,
          }));
          const { data: inserted } = await supabase.from("checklist_items").insert(items).select().order("position");
          if (inserted) setChecklistItems(inserted as ChecklistItem[]);
        }
      });
  }, [currentTripId, view, plannerTab]);

  // 예약 데이터는 plannerTab과 무관하게 항상 로드 (일정 탭에서도 예약 뱃지 표시 필요)
  useEffect(() => {
    if (!currentTripId || view !== "planner") { setBookings([]); setBookingFiles([]); return; }
    supabase.from("bookings").select("*").eq("trip_id", currentTripId)
      .order("start_date", { nullsFirst: false })
      .then(({ data }) => { if (data) setBookings(data as Booking[]); });
    supabase.from("booking_files").select("*").eq("trip_id", currentTripId)
      .order("created_at")
      .then(({ data }) => { if (data) setBookingFiles(data as BookingFile[]); });
  }, [currentTripId, view]);

  // Load expenses when opening a trip
  useEffect(() => {
    if (!currentTripId || view !== "planner") { setExpenses([]); return; }
    supabase.from("expenses").select("*").eq("trip_id", currentTripId).order("created_at")
      .then(({ data }) => { if (data) setExpenses(data as Expense[]); });
  }, [currentTripId, view]);

  // Load diary when entering diary view
  useEffect(() => {
    if (view !== "diary" || !currentTripId) return;
    setDiaryLoading(true);
    async function loadDiary() {
      const { data: diary } = await supabase
        .from("travel_diaries").select("*")
        .eq("trip_id", currentTripId!).maybeSingle();
      if (diary) {
        setCurrentDiary(diary as TravelDiary);
        currentDiaryIdRef.current = diary.id;
        setDiaryTitleValue(diary.title);
        const { data: blocks } = await supabase
          .from("diary_blocks").select("*")
          .eq("diary_id", diary.id).order("position");
        if (blocks) setDiaryBlocks(blocks as DiaryBlock[]);
      } else {
        setCurrentDiary(null);
        currentDiaryIdRef.current = null;
        setDiaryBlocks([]);
      }
      setDiaryLoading(false);
    }
    loadDiary();
  }, [view, currentTripId]);

  // Realtime subscription
  useEffect(() => {
    const CHANNEL = "trips-realtime";
    console.log(`[realtime] creating channel "${CHANNEL}" at`, new Date().toISOString());

    const channel = supabase
      .channel(CHANNEL)
      .on(
        "postgres_changes" as const,
        { event: "*", schema: "public", table: "trips" },
        (payload) => {
          console.log("[realtime] trips event received:", payload.eventType, "currentTripId:", currentTripIdRef.current, payload);
          if (payload.eventType === "DELETE") {
            const id = (payload.old as { id: string }).id;
            setTrips(prev => prev.filter(t => t.id !== id));
            if (id === currentTripIdRef.current) {
              setCurrentTripId(null);
              setView("home");
            }
            return;
          }
          const incoming = (payload.new as { data: Trip }).data;
          if (!incoming) return;
          isApplyingRealtimeRef.current = true;
          setTrips(prev => {
            const idx = prev.findIndex(t => t.id === incoming.id);
            if (idx === -1) {
              if (payload.eventType !== "INSERT") return prev;
              if ((payload.new as { owner_id?: string }).owner_id !== ownerIdRef.current) return prev;
              return [...prev, incoming];
            }
            if (JSON.stringify(prev[idx]) === JSON.stringify(incoming)) return prev;
            return prev.map(t => t.id === incoming.id ? incoming : t);
          });
          if (incoming.id === currentTripIdRef.current) {
            console.log("[currency] realtime trips UPDATE — incoming.info.currency:", incoming.info?.currency, "| incoming.info:", incoming.info);
            setTripInfo(local => {
              const sameInfo = JSON.stringify(local) === JSON.stringify(incoming.info);
              if (!sameInfo) console.log("[currency] realtime overwriting tripInfo — local.currency:", local.currency, "→ incoming.currency:", incoming.info?.currency);
              return sameInfo ? local : incoming.info;
            });
            setSchedules(local => {
              const normalized = ensureEventIds(incoming.schedules);
              return JSON.stringify(local) === JSON.stringify(normalized) ? local : normalized;
            });
            setCityStays(local =>
              JSON.stringify(local) === JSON.stringify(incoming.cityStays) ? local : incoming.cityStays
            );
          }
          setTimeout(() => { isApplyingRealtimeRef.current = false; }, 0);
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "INSERT", schema: "public", table: "trip_members" },
        (payload) => {
          console.log("[realtime] trip_members INSERT:", payload.new, "currentTripId:", currentTripIdRef.current);
          const row = payload.new as { trip_id: string; member_id: string; role: string; nickname?: string };
          if (row.trip_id !== currentTripIdRef.current) return;
          setMembers(prev =>
            prev.some(m => m.member_id === row.member_id)
              ? prev
              : [...prev, { member_id: row.member_id, role: row.role, nickname: row.nickname ?? undefined }]
          );
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "UPDATE", schema: "public", table: "trip_members" },
        (payload) => {
          console.log("[realtime] trip_members UPDATE:", payload.new, "currentTripId:", currentTripIdRef.current);
          const row = payload.new as { trip_id: string; member_id: string; nickname?: string; role: string };
          if (row.trip_id !== currentTripIdRef.current) return;
          setMembers(prev => prev.map(m =>
            m.member_id === row.member_id ? { ...m, nickname: row.nickname ?? undefined, role: row.role } : m
          ));
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "DELETE", schema: "public", table: "trip_members" },
        (payload) => {
          console.log("[realtime] trip_members DELETE:", payload.old, "currentTripId:", currentTripIdRef.current);
          const old = payload.old as { trip_id: string; member_id: string };
          if (old.trip_id === currentTripIdRef.current) {
            setMembers(prev => prev.filter(m => m.member_id !== old.member_id));
          }
          if (old.member_id === ownerIdRef.current) {
            setTrips(prev => prev.filter(t => t.id !== old.trip_id));
            if (old.trip_id === currentTripIdRef.current) {
              setCurrentTripId(null);
              setView("home");
            }
          }
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "INSERT", schema: "public", table: "event_records" },
        (payload) => {
          console.log("[realtime] event_records INSERT:", payload.new, "currentTripId:", currentTripIdRef.current);
          const record = payload.new as EventRecord;
          if (record.trip_id !== currentTripIdRef.current) return;
          setEventRecords(prev => prev.some(r => r.id === record.id) ? prev : [...prev, record]);
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "DELETE", schema: "public", table: "event_records" },
        (payload) => {
          console.log("[realtime] event_records DELETE:", payload.old);
          const old = payload.old as { id: string };
          setEventRecords(prev => prev.filter(r => r.id !== old.id));
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "*", schema: "public", table: "travel_diaries" },
        (payload) => {
          console.log("[realtime] travel_diaries:", payload.eventType, payload);
          if (payload.eventType === "INSERT") {
            const row = payload.new as TravelDiary;
            if (row.trip_id !== currentTripIdRef.current) return;
            if (currentDiaryIdRef.current) return; // 이미 다이어리 있으면 무시
            setCurrentDiary(row);
            currentDiaryIdRef.current = row.id;
            setDiaryTitleValue(row.title);
            supabase.from("diary_blocks").select("*")
              .eq("diary_id", row.id).order("position")
              .then(({ data }) => { if (data) setDiaryBlocks(data as DiaryBlock[]); });
          }
          if (payload.eventType === "UPDATE") {
            const row = payload.new as TravelDiary;
            if (row.trip_id !== currentTripIdRef.current) return;
            setCurrentDiary(prev => prev?.id === row.id ? { ...prev, title: row.title } : prev);
          }
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id: string };
            if (currentDiaryIdRef.current === old.id) {
              setCurrentDiary(null);
              setDiaryBlocks([]);
              currentDiaryIdRef.current = null;
            }
          }
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "INSERT", schema: "public", table: "diary_blocks" },
        (payload) => {
          const block = payload.new as DiaryBlock;
          if (block.diary_id !== currentDiaryIdRef.current) return;
          console.log("[realtime] diary_blocks INSERT:", block.id);
          setDiaryBlocks(prev => prev.some(b => b.id === block.id) ? prev : [...prev, block]);
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "UPDATE", schema: "public", table: "diary_blocks" },
        (payload) => {
          const block = payload.new as DiaryBlock;
          if (block.diary_id !== currentDiaryIdRef.current) return;
          console.log("[realtime] diary_blocks UPDATE:", block.id);
          setDiaryBlocks(prev => prev.map(b => b.id === block.id ? block : b));
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "DELETE", schema: "public", table: "diary_blocks" },
        (payload) => {
          const old = payload.old as { id: string };
          console.log("[realtime] diary_blocks DELETE:", old.id);
          setDiaryBlocks(prev => prev.filter(b => b.id !== old.id));
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "INSERT", schema: "public", table: "expenses" },
        (payload) => {
          const exp = payload.new as Expense;
          if (exp.trip_id !== currentTripIdRef.current) return;
          setExpenses(prev => prev.some(e => e.id === exp.id) ? prev : [...prev, exp]);
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "UPDATE", schema: "public", table: "expenses" },
        (payload) => {
          const exp = payload.new as Expense;
          if (exp.trip_id !== currentTripIdRef.current) return;
          setExpenses(prev => prev.map(e => e.id === exp.id ? exp : e));
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "DELETE", schema: "public", table: "expenses" },
        (payload) => {
          const old = payload.old as { id: string };
          setExpenses(prev => prev.filter(e => e.id !== old.id));
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "INSERT", schema: "public", table: "checklist_items" },
        (payload) => {
          console.log("[realtime] checklist_items INSERT:", payload.new, "currentTrip:", currentTripIdRef.current);
          const item = payload.new as ChecklistItem;
          if (item.trip_id !== currentTripIdRef.current) return;
          setChecklistItems(prev => prev.some(x => x.id === item.id) ? prev : [...prev, item].sort((a, b) => a.position - b.position));
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "UPDATE", schema: "public", table: "checklist_items" },
        (payload) => {
          console.log("[realtime] checklist_items UPDATE:", payload.new);
          const item = payload.new as ChecklistItem;
          if (item.trip_id !== currentTripIdRef.current) return;
          setChecklistItems(prev => prev.map(x => x.id === item.id ? item : x));
        }
      )
      .on(
        "postgres_changes" as const,
        { event: "DELETE", schema: "public", table: "checklist_items" },
        (payload) => {
          console.log("[realtime] checklist_items DELETE:", payload.old);
          const old = payload.old as { id: string };
          setChecklistItems(prev => prev.filter(x => x.id !== old.id));
        }
      )
      .on("postgres_changes" as const, { event: "INSERT", schema: "public", table: "bookings" }, (payload) => {
        console.log("[realtime] bookings INSERT:", payload.new);
        const b = payload.new as Booking;
        if (b.trip_id !== currentTripIdRef.current) return;
        setBookings(prev => prev.some(x => x.id === b.id) ? prev : [...prev, b]);
      })
      .on("postgres_changes" as const, { event: "UPDATE", schema: "public", table: "bookings" }, (payload) => {
        console.log("[realtime] bookings UPDATE:", payload.new);
        const b = payload.new as Booking;
        if (b.trip_id !== currentTripIdRef.current) return;
        setBookings(prev => prev.map(x => x.id === b.id ? b : x));
      })
      .on("postgres_changes" as const, { event: "DELETE", schema: "public", table: "bookings" }, (payload) => {
        console.log("[realtime] bookings DELETE:", payload.old);
        const old = payload.old as { id: string };
        setBookings(prev => prev.filter(x => x.id !== old.id));
      })
      .on("postgres_changes" as const, { event: "INSERT", schema: "public", table: "booking_files" }, (payload) => {
        console.log("[realtime] booking_files INSERT:", payload.new);
        const f = payload.new as BookingFile;
        if (f.trip_id !== currentTripIdRef.current) return;
        setBookingFiles(prev => prev.some(x => x.id === f.id) ? prev : [...prev, f]);
      })
      .on("postgres_changes" as const, { event: "DELETE", schema: "public", table: "booking_files" }, (payload) => {
        console.log("[realtime] booking_files DELETE:", payload.old);
        const old = payload.old as { id: string };
        setBookingFiles(prev => prev.filter(x => x.id !== old.id));
      })
      .subscribe((status, err) => {
        if (err) {
          console.error("[realtime] ❌ channel error:", status, err);
        } else if (status === "SUBSCRIBED") {
          console.log(`[realtime] ✅ SUBSCRIBED to "${CHANNEL}" — watching: trips, trip_members, event_records, expenses, checklist_items, bookings, booking_files`);
        } else {
          console.warn("[realtime] channel state →", status);
        }
      });

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Sync active planner state back into the trips array
  useEffect(() => {
    if (!canSave.current || !currentTripId) return;
    setTrips(prev => prev.map(t =>
      t.id === currentTripId ? { ...t, info: tripInfo, schedules, cityStays } : t
    ));
  }, [schedules, tripInfo, cityStays, currentTripId]);

  useEffect(() => {
    setTripInfo(t => ({ ...t, route: cityStays.map(s => s.name) }));
  }, [cityStays]);

  useEffect(() => {
    setSchedules(prev => {
      const next = { ...prev };
      cityStays.forEach((stay, i) => {
        if (!stay.startDate) return;
        const key = stay.startDate;
        const existing = new Set((next[key] || []).map(e => e.title));
        const toAdd: Event[] = [];
        if (i > 0) {
          const transitTitle = `${cityStays[i - 1].name} → ${stay.name}`;
          if (!existing.has(transitTitle))
            toAdd.push({ id: crypto.randomUUID(), time: "09:00", title: transitTitle, tag: "transit", detail: "" });
        }
        const arrivalTitle = `${stay.name} 도착`;
        if (!existing.has(arrivalTitle))
          toAdd.push({ id: crypto.randomUUID(), time: "14:00", title: arrivalTitle, tag: "flight", detail: "" });
        if (toAdd.length) next[key] = [...(next[key] || []), ...toAdd];
      });
      return next;
    });
  }, [cityStays]);

  useEffect(() => {
    if (!tripInfo.startDate) return;
    const [y, m] = tripInfo.startDate.split("-").map(Number);
    setViewYear(y);
    setViewMonth(m - 1);
  }, [tripInfo.startDate]);

  useEffect(() => { setShowForm(false); setEditing(null); }, [selectedDate]);

  useEffect(() => {
    if (!canSave.current) return;
    if (view === "planner" && currentTripId) {
      localStorage.setItem("lastView", "planner");
      localStorage.setItem("lastTripId", currentTripId);
    } else if (view === "home") {
      localStorage.setItem("lastView", "home");
    }
  }, [view, currentTripId]);

  useEffect(() => {
    if (!showLeaveModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setShowLeaveModal(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showLeaveModal]);

  const calCells = buildCalCells(viewYear, viewMonth);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  async function addEventRecord(eventId: string, type: EventRecord["type"], content: string) {
    if (!currentTripId) return;
    const nickname = members.find(m => m.member_id === ownerIdRef.current)?.nickname ?? "나";
    await supabase.from("event_records").insert({
      trip_id: currentTripId, event_id: eventId,
      type, content, user_id: ownerIdRef.current, nickname,
    });
    // state updated via realtime INSERT handler
  }

  async function deleteEventRecord(id: string) {
    await supabase.from("event_records").delete().eq("id", id);
    // state updated via realtime DELETE handler
  }

  async function uploadEventPhoto(eventId: string, file: File) {
    if (!currentTripId) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    const path = `${currentTripId}/${eventId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("event-photos").upload(path, file);
    if (upErr) throw upErr;
    const { data: { publicUrl } } = supabase.storage.from("event-photos").getPublicUrl(path);
    await addEventRecord(eventId, "photo", publicUrl);
  }

  function updateEvent(e: number, updated: Event) {
    const key = dateKey(selectedDate.year, selectedDate.month, selectedDate.day);
    setSchedules(prev => ({
      ...prev,
      [key]: (prev[key] || []).map((ev, ei) => ei !== e ? ev : updated),
    }));
  }

  function deleteEvent(e: number) {
    const key = dateKey(selectedDate.year, selectedDate.month, selectedDate.day);
    setSchedules(prev => ({ ...prev, [key]: (prev[key] || []).filter((_, i) => i !== e) }));
    setEditing(null);
  }

  function toggleEventComplete(eventId: string) {
    const key = dateKey(selectedDate.year, selectedDate.month, selectedDate.day);
    setSchedules(prev => ({
      ...prev,
      [key]: (prev[key] || []).map(ev =>
        ev.id === eventId ? { ...ev, completed: !ev.completed } : ev
      ),
    }));
  }

  function openTrip(trip: Trip, asMember = true) {
    console.log("[currency] openTrip — trip.info.currency:", trip.info.currency, "| full info:", trip.info);
    setPlannerTab("plan");
    setChecklistItems([]);
    setChecklistNewText("");
    setBookings([]);
    setBookingFiles([]);
    setExpandedBookingId(null);
    setShowBookingSheet(false);
    setIsMemberOfCurrentTrip(asMember);
    setCurrentUserRole(asMember ? (tripRolesRef.current.get(trip.id) ?? "editor") : "editor");
    setTripInfo(trip.info);
    setSchedules(ensureEventIds(trip.schedules));
    setCityStays(trip.cityStays);
    setCurrentTripId(trip.id);
    if (trip.info.startDate) {
      const [y, m, d] = trip.info.startDate.split("-").map(Number);
      setSelectedDate({ year: y, month: m - 1, day: d });
    } else {
      setSelectedDate(TODAY);
    }
    setView("planner");
  }

  function commitRename() {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      setTrips(prev => prev.map(t =>
        t.id === renamingId ? { ...t, info: { ...t.info, title: trimmed } } : t
      ));
    }
    setRenamingId(null);
  }

  async function joinTrip() {
    if (!currentTripId) return;
    const nick = nicknameInput.trim() || null;
    await supabase.from("trip_members").insert({
      trip_id: currentTripId,
      member_id: ownerIdRef.current,
      role: "editor",
      nickname: nick,
    });
    const trip: Trip = { id: currentTripId, info: tripInfo, schedules, cityStays };
    tripRolesRef.current.set(currentTripId, "editor");
    setTrips(prev => [...prev, trip]);
    setIsMemberOfCurrentTrip(true);
    setCurrentUserRole("editor");
    // members state updated via realtime INSERT handler
    setNicknameInput("");
    setShowNicknamePrompt(false);
  }

  async function leaveTrip() {
    if (!currentTripId) return;
    await supabase.from("trip_members").delete()
      .eq("trip_id", currentTripId).eq("member_id", ownerIdRef.current);
    tripRolesRef.current.delete(currentTripId);
    setTrips(prev => prev.filter(t => t.id !== currentTripId));
    setCurrentTripId(null);
    setView("home");
  }

  async function updateMyNickname(value: string) {
    if (!currentTripId) return;
    const nick = value.trim() || null;
    await supabase.from("trip_members").update({ nickname: nick })
      .eq("trip_id", currentTripId).eq("member_id", ownerIdRef.current);
    setEditingNickname(false);
    // members state updated via realtime UPDATE handler
  }

  async function removeMember(memberId: string) {
    await supabase.from("trip_members").delete()
      .eq("trip_id", currentTripId!).eq("member_id", memberId);
    // members state updated via realtime DELETE handler
  }

  async function changeMemberRole(memberId: string, role: string) {
    await supabase.from("trip_members").update({ role })
      .eq("trip_id", currentTripId!).eq("member_id", memberId);
    // members state updated via realtime UPDATE handler
  }

  // 다이어리 생성: travel_diaries 행만 생성 (블록은 동적 렌더링)
  async function createDiary() {
    if (!currentTripId || currentDiary) return;
    setDiaryLoading(true);
    const { data: diary, error } = await supabase.from("travel_diaries").insert({
      trip_id: currentTripId,
      title: tripInfo.title || "여행 다이어리",
      created_by: ownerIdRef.current,
    }).select().single();
    if (error || !diary) { setDiaryLoading(false); return; }
    setCurrentDiary(diary as TravelDiary);
    currentDiaryIdRef.current = diary.id;
    setDiaryTitleValue(diary.title);
    setDiaryLoading(false);
  }

  async function deleteDiary() {
    if (!currentDiary || !confirm("다이어리를 삭제할까요? 추가한 메모와 캡션도 함께 삭제됩니다.")) return;
    await supabase.from("travel_diaries").delete().eq("id", currentDiary.id);
    setCurrentDiary(null);
    setDiaryBlocks([]);
    currentDiaryIdRef.current = null;
    setDiaryEditMode(false);
  }

  async function saveDiaryTitle() {
    if (!currentDiary || !diaryTitleValue.trim()) { setEditingDiaryTitle(false); return; }
    const title = diaryTitleValue.trim();
    setCurrentDiary(prev => prev ? { ...prev, title } : prev);
    await supabase.from("travel_diaries").update({ title }).eq("id", currentDiary.id);
    setEditingDiaryTitle(false);
  }

  // 이벤트 제목 override 저장/수정
  async function upsertOverride(eventId: string, title: string, date: string) {
    if (!currentDiary || !currentTripId || !title.trim()) { setEditingEventId(null); return; }
    const existing = diaryBlocks.find(b => b.type === "event_title_override" && b.source_record_id === eventId);
    if (existing) {
      setDiaryBlocks(prev => prev.map(b => b.id === existing.id ? { ...b, event_title: title.trim() } : b));
      await supabase.from("diary_blocks").update({ event_title: title.trim(), updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      const { data: nb } = await supabase.from("diary_blocks").insert({
        diary_id: currentDiary.id, trip_id: currentTripId,
        type: "event_title_override", position: 0,
        event_title: title.trim(), source_record_id: eventId, block_date: date,
        content: null, photo_url: null, author: null, caption: null, event_time: null,
      }).select().single();
      if (nb) setDiaryBlocks(prev => prev.some(b => b.id === (nb as DiaryBlock).id) ? prev : [...prev, nb as DiaryBlock]);
    }
    setEditingEventId(null);
  }

  // 사진 캡션 저장/수정/삭제
  async function upsertCaption(recordId: string, cap: string | null, date: string) {
    if (!currentDiary || !currentTripId) { setEditingCaptionId(null); return; }
    const existing = diaryBlocks.find(b => b.type === "photo_caption" && b.source_record_id === recordId);
    if (existing) {
      if (!cap?.trim()) {
        setDiaryBlocks(prev => prev.filter(b => b.id !== existing.id));
        await supabase.from("diary_blocks").delete().eq("id", existing.id);
      } else {
        setDiaryBlocks(prev => prev.map(b => b.id === existing.id ? { ...b, caption: cap.trim() } : b));
        await supabase.from("diary_blocks").update({ caption: cap.trim(), updated_at: new Date().toISOString() }).eq("id", existing.id);
      }
    } else if (cap?.trim()) {
      const { data: nb } = await supabase.from("diary_blocks").insert({
        diary_id: currentDiary.id, trip_id: currentTripId,
        type: "photo_caption", position: 0,
        caption: cap.trim(), source_record_id: recordId, block_date: date,
        content: null, photo_url: null, author: null, event_title: null, event_time: null,
      }).select().single();
      if (nb) setDiaryBlocks(prev => prev.some(b => b.id === (nb as DiaryBlock).id) ? prev : [...prev, nb as DiaryBlock]);
    }
    setEditingCaptionId(null);
  }

  // 자유 문단 추가 (event anchor 또는 date 끝)
  async function addTextBlock() {
    if (!currentDiary || !currentTripId || !newBlockText.trim() || !addingInContext) return;
    const { eventId, date } = addingInContext;
    const existing = diaryBlocks.filter(b =>
      b.type === "text" && b.source_record_id === eventId &&
      (eventId !== null || b.block_date === date)
    );
    const maxPos = existing.length > 0 ? Math.max(...existing.map(b => b.position)) : 0;
    const { data: nb } = await supabase.from("diary_blocks").insert({
      diary_id: currentDiary.id, trip_id: currentTripId,
      type: "text", position: maxPos + 1, content: newBlockText.trim(),
      source_record_id: eventId, block_date: date,
      photo_url: null, author: null, caption: null, event_time: null, event_title: null,
    }).select().single();
    if (nb) setDiaryBlocks(prev => prev.some(b => b.id === (nb as DiaryBlock).id) ? prev : [...prev, nb as DiaryBlock]);
    setAddingInContext(null);
    setNewBlockText("");
  }

  // text 블록 내용 수정
  async function updateBlock(id: string, content: string) {
    setDiaryBlocks(prev => prev.map(b => b.id === id ? { ...b, content, updated_at: new Date().toISOString() } : b));
    await supabase.from("diary_blocks").update({ content, updated_at: new Date().toISOString() }).eq("id", id);
    setEditingBlockId(null);
  }

  // text 블록 삭제
  async function deleteBlock(id: string) {
    setDiaryBlocks(prev => prev.filter(b => b.id !== id));
    await supabase.from("diary_blocks").delete().eq("id", id);
  }

  // 다이어리 사진 블록 추가
  async function addDiaryImageBlock(file: File, context: AddCtx) {
    if (!currentDiary || !currentTripId) return;
    setUploadingDiaryImage(true);
    setAddingImageContext(null);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `diary/${currentTripId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("event-photos").upload(path, file);
      if (upErr) { alert(`사진 업로드 실패: ${upErr.message}`); return; }
      const { data: { publicUrl } } = supabase.storage.from("event-photos").getPublicUrl(path);
      const existing = diaryBlocks.filter(b =>
        (b.type === "text" || b.type === "image") &&
        b.source_record_id === context.eventId &&
        (context.eventId !== null || b.block_date === context.date)
      );
      const maxPos = existing.length > 0 ? Math.max(...existing.map(b => b.position)) : 0;
      const { data: nb } = await supabase.from("diary_blocks").insert({
        diary_id: currentDiary.id, trip_id: currentTripId,
        type: "image", position: maxPos + 1,
        photo_url: publicUrl, source_record_id: context.eventId, block_date: context.date,
        content: null, author: null, caption: null, event_time: null, event_title: null,
      }).select().single();
      if (nb) setDiaryBlocks(prev => prev.some(b => b.id === (nb as DiaryBlock).id) ? prev : [...prev, nb as DiaryBlock]);
    } finally {
      setUploadingDiaryImage(false);
    }
  }

  // 다이어리 사진 블록 삭제 (스토리지 + DB)
  async function deleteDiaryImageBlock(block: DiaryBlock) {
    if (block.photo_url) {
      const path = extractStoragePath(block.photo_url, "event-photos");
      if (path) await supabase.storage.from("event-photos").remove([path]);
    }
    await deleteBlock(block.id);
  }

  // ── 경비 CRUD ───────────────────────────────────────────────────────────────

  async function addExpense(dateOverride?: string) {
    const dateToUse = dateOverride ?? addingExpenseDate;
    console.log("[expense] addExpense called — guard values:", {
      currentTripId,
      dateToUse,
      amount: expenseForm.amount,
      guardPass: !!(currentTripId && dateToUse && expenseForm.amount),
    });
    if (!currentTripId || !dateToUse || !expenseForm.amount) return;
    const amount = parseFloat(expenseForm.amount);
    if (isNaN(amount) || amount <= 0) {
      console.warn("[expense] invalid amount:", expenseForm.amount, "→ parsed:", amount);
      return;
    }
    const nickname = members.find(m => m.member_id === ownerIdRef.current)?.nickname ?? null;
    const myNickname = members.find(m => m.member_id === ownerIdRef.current)?.nickname ?? null;
    const payload = {
      trip_id: currentTripId,
      expense_date: dateToUse,
      amount,
      currency: expenseForm.currency,
      category: expenseForm.category,
      memo: expenseForm.memo.trim() || null,
      event_id: expenseForm.event_id || null,
      user_id: ownerIdRef.current,
      nickname: myNickname,
      payer: expenseForm.payer.trim() || myNickname || null,
      is_shared: expenseForm.is_shared,
      participants: expenseForm.is_shared && expenseForm.participants.length > 0 ? expenseForm.participants : [],
    };
    const { data, error } = await supabase.from("expenses").insert(payload).select().single();
    if (error) {
      console.error("[expense] insert failed:", error.code, error.message, error.details);
      alert(`경비 저장 실패: ${error.message}`);
      return;
    }
    if (data) {
      setExpenses(prev => prev.some(e => e.id === (data as Expense).id) ? prev : [...prev, data as Expense]);
      try {
        localStorage.setItem(`expense-prefs-${currentTripId}`, JSON.stringify({ currency: expenseForm.currency, category: expenseForm.category, payer: expenseForm.payer }));
      } catch {}
    }
    setExpenseForm({ amount: "", currency: expenseForm.currency, category: expenseForm.category, memo: "", event_id: "", payer: expenseForm.payer, is_shared: expenseForm.is_shared, participants: expenseForm.participants });
    setAddingExpenseDate(null);
  }

  async function updateExpense() {
    if (!editingExpenseId || !editExpenseForm.amount) return;
    const amount = parseFloat(editExpenseForm.amount);
    if (isNaN(amount) || amount <= 0) return;
    const updates = {
      amount,
      currency: editExpenseForm.currency,
      category: editExpenseForm.category as ExpenseCategory,
      memo: editExpenseForm.memo.trim() || null,
      event_id: editExpenseForm.event_id || null,
    };
    setExpenses(prev => prev.map(e => e.id === editingExpenseId ? { ...e, ...updates } : e));
    await supabase.from("expenses").update(updates).eq("id", editingExpenseId);
    try {
      if (currentTripId) localStorage.setItem(`expense-prefs-${currentTripId}`, JSON.stringify({ currency: editExpenseForm.currency, category: editExpenseForm.category }));
    } catch {}
    setEditingExpenseId(null);
  }

  async function deleteExpense(id: string) {
    setExpenses(prev => prev.filter(e => e.id !== id));
    await supabase.from("expenses").delete().eq("id", id);
  }

  // ── 체크리스트 CRUD ─────────────────────────────────────────────────────────

  async function toggleChecklistItem(id: string, checked: boolean) {
    setChecklistItems(prev => prev.map(x => x.id === id ? { ...x, checked } : x));
    await supabase.from("checklist_items").update({ checked }).eq("id", id);
  }

  async function addChecklistItem() {
    if (!checklistNewText.trim() || !currentTripId) return;
    const position = checklistItems.length;
    const { data } = await supabase.from("checklist_items").insert({
      trip_id: currentTripId, text: checklistNewText.trim(), checked: false, position,
    }).select().single();
    if (data) setChecklistItems(prev => prev.some(x => x.id === (data as ChecklistItem).id) ? prev : [...prev, data as ChecklistItem]);
    setChecklistNewText("");
  }

  async function deleteChecklistItem(id: string) {
    setChecklistItems(prev => prev.filter(x => x.id !== id));
    await supabase.from("checklist_items").delete().eq("id", id);
  }

  // ── 예약 CRUD ──────────────────────────────────────────────────────────────

  async function saveBooking() {
    if (!bookingForm.title.trim() || !currentTripId) return;
    const payload = {
      trip_id: currentTripId,
      type: bookingForm.type,
      title: bookingForm.title.trim(),
      start_date: bookingForm.start_date || null,
      start_time: bookingForm.start_time || null,
      end_date: bookingForm.end_date || null,
      end_time: bookingForm.end_time || null,
      link: bookingForm.link.trim() || null,
      memo: bookingForm.memo.trim() || null,
      provider: bookingForm.provider.trim() || null,
      booking_ref: bookingForm.booking_ref.trim() || null,
    };
    if (editingBooking) {
      const { data } = await supabase.from("bookings").update(payload).eq("id", editingBooking.id).select().single();
      if (data) setBookings(prev => prev.map(x => x.id === editingBooking.id ? data as Booking : x));
    } else {
      const { data } = await supabase.from("bookings").insert(payload).select().single();
      if (data) {
        const newBooking = data as Booking;
        setBookings(prev => prev.some(x => x.id === newBooking.id) ? prev : [...prev, newBooking]);
        setExpandedBookingId(newBooking.id);
        // 선택된 일정에 이 예약 연결
        if (bookingForm.event_link_id) {
          setSchedules(prev => {
            const next: typeof prev = {};
            for (const [date, events] of Object.entries(prev)) {
              next[date] = events.map(e =>
                e.id === bookingForm.event_link_id ? { ...e, booking_id: newBooking.id } : e
              );
            }
            return next;
          });
        }
      }
    }
    setShowBookingSheet(false);
    setEditingBooking(null);
    setBookingForm(BOOKING_FORM_INIT);
  }

  async function deleteBooking(id: string) {
    const files = bookingFiles.filter(f => f.booking_id === id);
    await Promise.all(files.map(async f => {
      const path = extractStoragePath(f.url, "booking-files");
      if (path) await supabase.storage.from("booking-files").remove([path]);
    }));
    setBookings(prev => prev.filter(x => x.id !== id));
    setBookingFiles(prev => prev.filter(x => x.booking_id !== id));
    await supabase.from("bookings").delete().eq("id", id);
    if (expandedBookingId === id) setExpandedBookingId(null);
  }

  async function uploadBookingFile(bookingId: string, file: File) {
    if (!currentTripId) return;
    setUploadingBookingId(bookingId);
    console.log("[booking-upload] starting —", file.name, file.type, file.size);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const path = `${currentTripId}/${bookingId}/${crypto.randomUUID()}.${ext}`;
      console.log("[booking-upload] storage path:", path);
      const { data: upData, error: upErr } = await supabase.storage.from("booking-files").upload(path, file);
      if (upErr) {
        console.error("[booking-upload] ❌ storage error:", upErr.message, upErr);
        alert(`파일 업로드 실패: ${upErr.message}`);
        return;
      }
      console.log("[booking-upload] ✅ storage ok:", upData);
      const { data: { publicUrl } } = supabase.storage.from("booking-files").getPublicUrl(path);
      const { data, error: dbErr } = await supabase.from("booking_files").insert({
        booking_id: bookingId, trip_id: currentTripId,
        name: file.name, url: publicUrl,
        mime: file.type || (ext === "pdf" ? "application/pdf" : "image/jpeg"),
      }).select().single();
      if (dbErr) { console.error("[booking-upload] ❌ db error:", dbErr.message); return; }
      console.log("[booking-upload] ✅ db row created:", (data as BookingFile).id);
      if (data) setBookingFiles(prev => prev.some(x => x.id === (data as BookingFile).id) ? prev : [...prev, data as BookingFile]);
    } finally {
      setUploadingBookingId(null);
    }
  }

  async function deleteBookingFile(file: BookingFile) {
    const path = extractStoragePath(file.url, "booking-files");
    if (path) await supabase.storage.from("booking-files").remove([path]);
    setBookingFiles(prev => prev.filter(x => x.id !== file.id));
    await supabase.from("booking_files").delete().eq("id", file.id);
  }

  function duplicateTrip(id: string) {
    const src = trips.find(t => t.id === id);
    if (!src) return;
    const copy: Trip = { ...JSON.parse(JSON.stringify(src)), id: crypto.randomUUID() };
    copy.info.title += " (copy)";
    setTrips(prev => [...prev, copy]);
    setMenuOpen(null);
  }

  function deleteTrip(id: string) {
    if (!confirm("이 여행을 삭제할까요?")) return;
    setTrips(prev => prev.filter(t => t.id !== id));
    setMenuOpen(null);
  }

  function createNewTrip() {
    const id = crypto.randomUUID();
    ownedTripIdsRef.current.add(id);
    const newTrip: Trip = { id, info: { ...INITIAL_TRIP }, schedules: {}, cityStays: [] };
    setTrips(prev => [...prev, newTrip]);
    setTripInfo(newTrip.info);
    setSchedules({});
    setCityStays([]);
    setCurrentTripId(id);
    setSelectedDate(TODAY);
    setEditingTrip(true);
    setIsMemberOfCurrentTrip(true);
    setCurrentUserRole("owner");
    setView("planner");
  }

  function addEvent() {
    if (!form.title.trim()) return;
    const key = dateKey(selectedDate.year, selectedDate.month, selectedDate.day);
    setSchedules(prev => ({
      ...prev,
      [key]: [...(prev[key] || []), { id: crypto.randomUUID(), ...form, detail: "", booking_id: form.booking_id || null }],
    }));
    setForm({ time: "09:00", title: "", tag: "activity", location: undefined, booking_id: "" });
    setShowForm(false);
  }

  function addCity() {
    if (!cityForm.name.trim()) return;
    setCityStays(prev => [...prev, { name: cityForm.name.trim(), startDate: cityForm.startDate, endDate: cityForm.endDate }]);
    setCityForm({ name: "", startDate: "", endDate: "" });
    setShowCityForm(false);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  const tripDays = tripInfo.startDate && tripInfo.endDate
    ? Math.round((new Date(tripInfo.endDate).getTime() - new Date(tripInfo.startDate).getTime()) / 86400000) + 1
    : 0;

  const isOwner = currentUserRole === "owner";
  const canEdit = currentUserRole === "owner" || currentUserRole === "editor";

  // Selected-day derived values
  const selKey    = dateKey(selectedDate.year, selectedDate.month, selectedDate.day);
  const selEvents = schedules[selKey] || [];
  const isToday   = selectedDate.year === TODAY.year && selectedDate.month === TODAY.month && selectedDate.day === TODAY.day;

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    setSchedules(prev => ({
      ...prev,
      [selKey]: arrayMove(prev[selKey] || [], Number(active.id), Number(over.id)),
    }));
  }

  if (view === "diary") {
    // ── Build lookup maps from saved diary_blocks ──────────────────────────────
    const overrideByEvent = new Map<string, DiaryBlock>();
    const captionByRecord = new Map<string, DiaryBlock>();
    const blocksByEvent = new Map<string, DiaryBlock[]>();
    const blocksByDate  = new Map<string, DiaryBlock[]>();
    for (const b of diaryBlocks) {
      if (b.type === "event_title_override" && b.source_record_id)
        overrideByEvent.set(b.source_record_id, b);
      else if (b.type === "photo_caption" && b.source_record_id)
        captionByRecord.set(b.source_record_id, b);
      else if (b.type === "text" || b.type === "image") {
        if (b.source_record_id) {
          if (!blocksByEvent.has(b.source_record_id)) blocksByEvent.set(b.source_record_id, []);
          blocksByEvent.get(b.source_record_id)!.push(b);
        } else if (b.block_date) {
          if (!blocksByDate.has(b.block_date)) blocksByDate.set(b.block_date, []);
          blocksByDate.get(b.block_date)!.push(b);
        }
      }
    }
    blocksByEvent.forEach((v, k) => blocksByEvent.set(k, [...v].sort((a, b) => a.position - b.position)));
    blocksByDate.forEach((v, k)  => blocksByDate.set(k,  [...v].sort((a, b) => a.position - b.position)));

    const dates = tripInfo.startDate && tripInfo.endDate
      ? getDatesInRange(tripInfo.startDate, tripInfo.endDate)
      : Object.keys(schedules).sort();

    const renderedBlockIds = new Set<string>();

    const stopEditing = () => {
      setDiaryEditMode(false);
      setEditingBlockId(null);
      setAddingInContext(null);
      setAddingImageContext(null);
      setEditingDiaryTitle(false);
      setEditingCaptionId(null);
      setEditingEventId(null);
    };

    const handlePrint = () => {
      stopEditing();
      setTimeout(() => window.print(), 200);
    };

    // 커버 페이지 통계
    const totalEvents = Object.values(schedules).flat().length;
    const memoCount = eventRecords.filter(r => r.type === "memo").length;
    const photoCount = eventRecords.filter(r => r.type === "photo").length;
    const memberNames = members.length > 0
      ? members.map(m => m.nickname || "멤버").join(" · ")
      : null;
    const createdDateStr = currentDiary
      ? new Date(currentDiary.created_at).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" })
      : "";

    return (
      <div className="min-h-screen font-sans" style={{ background: "#F7F7F5" }}>
        {/* Header — 인쇄 시 숨김 */}
        <header className="print-hide" style={{
          position: "sticky", top: 0, zIndex: 30, background: "#fff",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
          padding: "12px 20px", display: "flex", alignItems: "center", gap: 12,
        }}>
          <button onClick={() => { stopEditing(); setView("planner"); }}
            style={{ fontSize: 20, color: "#aaa", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: "0 4px", flexShrink: 0 }}>‹</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "#aaa", margin: 0 }}>여행 다이어리</p>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", margin: "2px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {currentDiary?.title ?? tripInfo.title}
            </p>
          </div>
          {currentDiary && (
            <>
              {!diaryEditMode && (
                <button onClick={handlePrint}
                  style={{ fontSize: 12, color: "#666", background: "none", border: "1px solid #ddd", borderRadius: 20, padding: "5px 14px", cursor: "pointer", flexShrink: 0 }}>
                  PDF 저장
                </button>
              )}
              {diaryEditMode ? (
                <>
                  <button onClick={deleteDiary}
                    style={{ fontSize: 12, color: "#FF453A", background: "none", border: "1px solid rgba(255,69,58,0.3)", borderRadius: 20, padding: "5px 14px", cursor: "pointer", flexShrink: 0 }}>
                    삭제
                  </button>
                  <button onClick={stopEditing}
                    style={{ fontSize: 12, fontWeight: 600, color: "#0A84FF", background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: "5px 0" }}>
                    완료
                  </button>
                </>
              ) : (
                <button onClick={() => setDiaryEditMode(true)}
                  style={{ fontSize: 12, color: "#0A84FF", background: "none", border: "none", cursor: "pointer", flexShrink: 0, fontWeight: 500 }}>
                  편집
                </button>
              )}
            </>
          )}
        </header>

        {/* 커버 페이지 — 인쇄 시에만 표시, 첫 페이지 전체 차지 */}
        {currentDiary && (
          <div className="print-cover">
            <div style={{ borderTop: "3px solid #1a1a1a", paddingTop: 28 }}>
              <h1 style={{ fontSize: 40, fontWeight: 700, color: "#1a1a1a", margin: "0 0 10px", lineHeight: 1.2 }}>
                {currentDiary.title}
              </h1>
              {(tripInfo.startDate || tripInfo.endDate) && (
                <p style={{ fontSize: 16, color: "#888", margin: 0, letterSpacing: "0.02em" }}>
                  {tripInfo.startDate?.replace(/-/g, ". ")}{tripInfo.endDate ? ` — ${tripInfo.endDate.replace(/-/g, ". ")}` : ""}
                </p>
              )}

              <div style={{ marginTop: 48, display: "flex", flexDirection: "column", gap: 14 }}>
                {memberNames && (
                  <div style={{ display: "flex", gap: 0 }}>
                    <span style={{ fontSize: 13, color: "#aaa", minWidth: 64 }}>멤버</span>
                    <span style={{ fontSize: 13, color: "#1a1a1a" }}>{memberNames}</span>
                  </div>
                )}
                <div style={{ display: "flex" }}>
                  <span style={{ fontSize: 13, color: "#aaa", minWidth: 64 }}>일정</span>
                  <span style={{ fontSize: 13, color: "#1a1a1a" }}>{totalEvents}개</span>
                </div>
                <div style={{ display: "flex" }}>
                  <span style={{ fontSize: 13, color: "#aaa", minWidth: 64 }}>기록</span>
                  <span style={{ fontSize: 13, color: "#1a1a1a" }}>
                    {memoCount + photoCount}개
                    {(memoCount > 0 || photoCount > 0) && (
                      <span style={{ color: "#bbb", marginLeft: 8 }}>메모 {memoCount} · 사진 {photoCount}</span>
                    )}
                  </span>
                </div>
                <div style={{ display: "flex" }}>
                  <span style={{ fontSize: 13, color: "#aaa", minWidth: 64 }}>생성일</span>
                  <span style={{ fontSize: 13, color: "#1a1a1a" }}>{createdDateStr}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "32px 24px 100px" }}>
          {diaryLoading ? (
            <div style={{ textAlign: "center", color: "#aaa", paddingTop: 80, fontSize: 14 }}>로딩 중...</div>
          ) : !currentDiary ? (
            <div style={{ textAlign: "center", paddingTop: 80 }}>
              <p style={{ fontSize: 36, margin: "0 0 20px" }}>📖</p>
              <p style={{ fontSize: 16, fontWeight: 600, color: "#1a1a1a", margin: "0 0 10px" }}>아직 다이어리가 없어요</p>
              <p style={{ fontSize: 13, color: "#888", margin: "0 0 32px", lineHeight: 1.7 }}>
                일정과 기록을 기반으로 다이어리를 생성합니다.<br />이후 추가되는 기록도 자동으로 반영됩니다.
              </p>
              <button onClick={createDiary}
                style={{ fontSize: 14, fontWeight: 500, color: "#fff", background: "#1a1a1a", border: "none", borderRadius: 10, padding: "12px 28px", cursor: "pointer" }}>
                + 다이어리 생성
              </button>
            </div>
          ) : (
            <>
              {/* 제목 */}
              <div style={{ marginBottom: 6 }}>
                {editingDiaryTitle ? (
                  <input autoFocus value={diaryTitleValue}
                    onChange={e => setDiaryTitleValue(e.target.value)}
                    onBlur={saveDiaryTitle}
                    onKeyDown={e => { if (e.key === "Enter") saveDiaryTitle(); if (e.key === "Escape") { setEditingDiaryTitle(false); setDiaryTitleValue(currentDiary.title); } }}
                    style={{ fontSize: 26, fontWeight: 700, color: "#1a1a1a", border: "none", borderBottom: "2px solid rgba(0,0,0,0.12)", outline: "none", background: "transparent", width: "100%", padding: 0, fontFamily: "inherit" }}
                  />
                ) : (
                  <h1 onClick={() => { if (diaryEditMode) { setEditingDiaryTitle(true); setDiaryTitleValue(currentDiary.title); } }}
                    style={{ fontSize: 26, fontWeight: 700, color: "#1a1a1a", margin: 0, cursor: diaryEditMode ? "text" : "default" }}>
                    {currentDiary.title}
                    {diaryEditMode && <span style={{ fontSize: 11, color: "#ccc", marginLeft: 8, fontWeight: 400 }}>수정</span>}
                  </h1>
                )}
              </div>
              {(tripInfo.startDate || tripInfo.endDate) && (
                <p style={{ fontSize: 13, color: "#aaa", margin: "0 0 16px" }}>
                  {tripInfo.startDate?.replace(/-/g, ". ")}{tripInfo.endDate ? ` — ${tripInfo.endDate.replace(/-/g, ". ")}` : ""}
                </p>
              )}
              {!diaryEditMode && (
                <div onClick={() => setDiaryEditMode(true)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "#F7F7F5", borderRadius: 10, marginBottom: 28, cursor: "pointer", userSelect: "none" as const }}>
                  <span style={{ fontSize: 16 }}>✏️</span>
                  <p style={{ fontSize: 13, color: "#8E8E93", margin: 0 }}>사진·문단을 추가하려면 여기를 눌러 편집 모드로 전환하세요</p>
                </div>
              )}

              {/* ── 날짜별 동적 렌더링 ─────────────────────────────── */}
              {dates.map((date, di) => {
                const dayEvents = schedules[date] || [];
                const dateLevelBlocks = (blocksByDate.get(date) ?? []);
                dateLevelBlocks.forEach(b => renderedBlockIds.add(b.id));
                const isAddingEndOfDay = addingInContext?.eventId === null && addingInContext?.date === date;

                return (
                  <div key={date}>
                    {/* 날짜 헤더 */}
                    <div style={{ marginTop: di === 0 ? 0 : 44, marginBottom: 20, paddingBottom: 12, borderBottom: "1px solid #e8e5e0" }}>
                      <p style={{ fontSize: 15, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>{formatBlockDate(date)}</p>
                    </div>

                    {/* 이벤트 목록 */}
                    {dayEvents.map(ev => {
                      const override = overrideByEvent.get(ev.id) ?? null;
                      const displayTitle = override?.event_title ?? ev.title;
                      const isEditingThisEvent = editingEventId === ev.id;
                      const isAddingAfterEvent = addingInContext?.eventId === ev.id;
                      const evRecords = eventRecords
                        .filter(r => r.event_id === ev.id)
                        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                      const evBlocks = (blocksByEvent.get(ev.id) ?? []);
                      evBlocks.forEach(b => renderedBlockIds.add(b.id));

                      return (
                        <div key={ev.id} className="diary-event-block" style={{ marginBottom: 4 }}>
                          {/* 이벤트 헤더 */}
                          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 22, marginBottom: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, flexShrink: 0, minWidth: 36, color: ev.completed ? "#0A84FF" : "#aaa" }}>
                              {ev.completed ? "✓" : ""}{ev.completed ? " " : ""}{ev.time}
                            </span>
                            {isEditingThisEvent ? (
                              <div style={{ flex: 1, display: "flex", gap: 8, alignItems: "center" }}>
                                <input autoFocus value={editingEventValue}
                                  onChange={e => setEditingEventValue(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") upsertOverride(ev.id, editingEventValue, date); if (e.key === "Escape") setEditingEventId(null); }}
                                  style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", border: "none", borderBottom: "1px solid rgba(0,0,0,0.12)", outline: "none", background: "transparent", flex: 1, padding: "2px 0", fontFamily: "inherit" }}
                                />
                                <button onClick={() => upsertOverride(ev.id, editingEventValue, date)}
                                  style={{ fontSize: 11, color: "#0A84FF", background: "none", border: "none", cursor: "pointer" }}>저장</button>
                                <button onClick={() => setEditingEventId(null)}
                                  style={{ fontSize: 11, color: "#aaa", background: "none", border: "none", cursor: "pointer" }}>취소</button>
                              </div>
                            ) : (
                              <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                                <span style={{
                                  fontSize: 14, fontWeight: 600,
                                  color: ev.completed ? "#9ca3af" : "#1a1a1a",
                                  textDecoration: ev.completed ? "line-through" : "none",
                                  textDecorationColor: "#9ca3af",
                                }}>{displayTitle}</span>
                                {diaryEditMode && (
                                  <button onClick={() => { setEditingEventId(ev.id); setEditingEventValue(displayTitle); }}
                                    style={{ fontSize: 11, color: "#999", background: "none", border: "1px solid #e8e5e0", borderRadius: 4, padding: "2px 8px", cursor: "pointer", flexShrink: 0 }}>수정</button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* 기록 (메모/사진) — event_records에서 동적 렌더링 */}
                          {evRecords.map(rec => {
                            const capBlock = captionByRecord.get(rec.id) ?? null;
                            const isEditingThisCaption = editingCaptionId === rec.id;
                            return (
                              <div key={rec.id} style={{ paddingLeft: 20, marginBottom: 10 }}>
                                <p style={{ fontSize: 11, color: "#0A84FF", fontWeight: 600, margin: "0 0 3px" }}>{rec.nickname}</p>
                                {rec.type === "memo" ? (
                                  <p style={{ fontSize: 13, color: "#333", margin: 0, lineHeight: 1.75, whiteSpace: "pre-wrap" }}>{rec.content}</p>
                                ) : (
                                  <div>
                                    <img src={rec.content} alt="여행 사진"
                                      style={{ width: "100%", borderRadius: 10, display: "block", maxHeight: 360, objectFit: "cover" }} />
                                    {isEditingThisCaption ? (
                                      <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                                        <input autoFocus placeholder="사진 설명 입력..."
                                          value={captionValue}
                                          onChange={e => setCaptionValue(e.target.value)}
                                          onKeyDown={e => { if (e.key === "Enter") upsertCaption(rec.id, captionValue, date); if (e.key === "Escape") setEditingCaptionId(null); }}
                                          style={{ flex: 1, fontSize: 12, border: "1px solid #ddd", borderRadius: 6, padding: "6px 10px", outline: "none", fontFamily: "inherit" }}
                                        />
                                        <button onClick={() => upsertCaption(rec.id, captionValue, date)}
                                          style={{ fontSize: 11, color: "#fff", background: "#1a1a1a", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" }}>저장</button>
                                        <button onClick={() => setEditingCaptionId(null)}
                                          style={{ fontSize: 11, color: "#aaa", background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}>취소</button>
                                      </div>
                                    ) : capBlock?.caption ? (
                                      <p onClick={() => { if (diaryEditMode) { setEditingCaptionId(rec.id); setCaptionValue(capBlock.caption ?? ""); } }}
                                        style={{ fontSize: 12, color: "#999", margin: "6px 0 0", fontStyle: "italic", cursor: diaryEditMode ? "text" : "default", lineHeight: 1.5 }}>
                                        {capBlock.caption}{diaryEditMode && <span style={{ fontSize: 10, color: "#ccc", marginLeft: 6 }}>수정</span>}
                                      </p>
                                    ) : diaryEditMode ? (
                                      <button onClick={() => { setEditingCaptionId(rec.id); setCaptionValue(""); }}
                                        style={{ fontSize: 11, color: "#bbb", background: "none", border: "none", cursor: "pointer", marginTop: 6, padding: 0, display: "block" }}>+ 캡션 추가</button>
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* 이 이벤트에 연결된 블록 (text + image) */}
                          {evBlocks.map(block => (
                            <div key={block.id} style={{ paddingLeft: 20, marginBottom: 8 }}>
                              {block.type === "image" ? (
                                <div>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={block.photo_url!} alt="다이어리 사진"
                                    style={{ width: "100%", borderRadius: 12, maxHeight: 400, objectFit: "cover", display: "block" }} />
                                  {diaryEditMode && (
                                    <button onClick={() => deleteDiaryImageBlock(block)}
                                      style={{ fontSize: 11, color: "#e88", background: "none", border: "1px solid #f5d4d4", borderRadius: 6, padding: "3px 10px", cursor: "pointer", marginTop: 6, display: "block" }}>
                                      사진 삭제
                                    </button>
                                  )}
                                </div>
                              ) : (
                                editingBlockId === block.id ? (
                                  <div>
                                    <textarea autoFocus value={editingBlockValue}
                                      onChange={e => setEditingBlockValue(e.target.value)}
                                      style={{ fontSize: 13, color: "#333", border: "1px solid #ddd", borderRadius: 8, padding: "10px 12px", width: "100%", outline: "none", resize: "vertical", lineHeight: 1.7, fontFamily: "inherit", minHeight: 72, boxSizing: "border-box" }}
                                    />
                                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                                      <button onClick={() => updateBlock(block.id, editingBlockValue)}
                                        style={{ fontSize: 11, color: "#fff", background: "#1a1a1a", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer" }}>저장</button>
                                      <button onClick={() => setEditingBlockId(null)}
                                        style={{ fontSize: 11, color: "#aaa", background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>취소</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, justifyContent: "space-between" }}>
                                    <p style={{ fontSize: 13, color: "#333", margin: 0, lineHeight: 1.75, flex: 1, whiteSpace: "pre-wrap" }}>{block.content}</p>
                                    {diaryEditMode && (
                                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                        <button onClick={() => { setEditingBlockId(block.id); setEditingBlockValue(block.content ?? ""); }}
                                          style={{ fontSize: 11, color: "#666", background: "none", border: "1px solid #e8e5e0", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>수정</button>
                                        <button onClick={() => deleteBlock(block.id)}
                                          style={{ fontSize: 11, color: "#e88", background: "none", border: "1px solid #f5d4d4", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>삭제</button>
                                      </div>
                                    )}
                                  </div>
                                )
                              )}
                            </div>
                          ))}

                          {/* + 문단 / 사진 추가 (이벤트 다음) */}
                          {diaryEditMode && (
                            isAddingAfterEvent ? (
                              <div style={{ paddingLeft: 20, marginTop: 4, marginBottom: 8 }}>
                                <textarea autoFocus placeholder="여기에 자유롭게 입력하세요..."
                                  value={newBlockText} onChange={e => setNewBlockText(e.target.value)}
                                  style={{ fontSize: 13, color: "#333", border: "1px solid #ddd", borderRadius: 8, padding: "10px 12px", width: "100%", outline: "none", resize: "vertical", lineHeight: 1.7, fontFamily: "inherit", minHeight: 72, boxSizing: "border-box" }}
                                />
                                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                                  <button onClick={addTextBlock}
                                    style={{ fontSize: 11, color: "#fff", background: "#1a1a1a", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer" }}>저장</button>
                                  <button onClick={() => { setAddingInContext(null); setNewBlockText(""); }}
                                    style={{ fontSize: 11, color: "#aaa", background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>취소</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 4, paddingLeft: 20 }}>
                                <input
                                  id={`diary-photo-ev-${ev.id}`}
                                  type="file" accept="image/*"
                                  style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", clip: "rect(0 0 0 0)", pointerEvents: "none" }}
                                  onChange={async e => {
                                    const f = e.target.files?.[0];
                                    if (!f || uploadingDiaryImage) return;
                                    setAddingImageContext({ eventId: ev.id, date });
                                    await addDiaryImageBlock(f, { eventId: ev.id, date });
                                    e.target.value = "";
                                  }}
                                />
                                <button onClick={() => { setAddingInContext({ eventId: ev.id, date }); setNewBlockText(""); }}
                                  style={{ fontSize: 12, color: "#6b7280", background: "#F7F7F5", border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, minHeight: 36 }}>
                                  📝 문단
                                </button>
                                <button
                                  disabled={uploadingDiaryImage}
                                  onClick={() => {
                                    const inp = document.getElementById(`diary-photo-ev-${ev.id}`) as HTMLInputElement | null;
                                    inp?.click();
                                  }}
                                  style={{ fontSize: 12, color: uploadingDiaryImage && addingImageContext?.eventId === ev.id ? "#ccc" : "#6b7280", background: "#F7F7F5", border: "none", borderRadius: 8, padding: "7px 14px", cursor: uploadingDiaryImage ? "default" : "pointer", display: "flex", alignItems: "center", gap: 4, minHeight: 36 }}>
                                  {uploadingDiaryImage && addingImageContext?.eventId === ev.id ? "⏳ 업로드 중..." : "📷 사진"}
                                </button>
                              </div>
                            )
                          )}
                        </div>
                      );
                    })}

                    {/* 하루 총평 (날짜 끝 블록 — text + image) */}
                    {dateLevelBlocks.map(block => (
                      <div key={block.id} style={{ paddingLeft: 0, marginTop: 12, marginBottom: 8 }}>
                        {block.type === "image" ? (
                          <div>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={block.photo_url!} alt="다이어리 사진"
                              style={{ width: "100%", borderRadius: 12, maxHeight: 400, objectFit: "cover", display: "block" }} />
                            {diaryEditMode && (
                              <button onClick={() => deleteDiaryImageBlock(block)}
                                style={{ fontSize: 11, color: "#e88", background: "none", border: "1px solid #f5d4d4", borderRadius: 6, padding: "3px 10px", cursor: "pointer", marginTop: 6, display: "block" }}>
                                사진 삭제
                              </button>
                            )}
                          </div>
                        ) : (
                          editingBlockId === block.id ? (
                            <div>
                              <textarea autoFocus value={editingBlockValue}
                                onChange={e => setEditingBlockValue(e.target.value)}
                                style={{ fontSize: 13, color: "#333", border: "1px solid #ddd", borderRadius: 8, padding: "10px 12px", width: "100%", outline: "none", resize: "vertical", lineHeight: 1.7, fontFamily: "inherit", minHeight: 72, boxSizing: "border-box" }}
                              />
                              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                                <button onClick={() => updateBlock(block.id, editingBlockValue)}
                                  style={{ fontSize: 11, color: "#fff", background: "#1a1a1a", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer" }}>저장</button>
                                <button onClick={() => setEditingBlockId(null)}
                                  style={{ fontSize: 11, color: "#aaa", background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>취소</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, justifyContent: "space-between", background: "#faf9f7", borderRadius: 8, padding: "10px 14px" }}>
                              <p style={{ fontSize: 13, color: "#555", margin: 0, lineHeight: 1.75, flex: 1, whiteSpace: "pre-wrap" }}>{block.content}</p>
                              {diaryEditMode && (
                                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                                  <button onClick={() => { setEditingBlockId(block.id); setEditingBlockValue(block.content ?? ""); }}
                                    style={{ fontSize: 11, color: "#666", background: "none", border: "1px solid #e8e5e0", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>수정</button>
                                  <button onClick={() => deleteBlock(block.id)}
                                    style={{ fontSize: 11, color: "#e88", background: "none", border: "1px solid #f5d4d4", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>삭제</button>
                                </div>
                              )}
                            </div>
                          )
                        )}
                      </div>
                    ))}

                    {/* + 날짜 끝 블록 추가 (문단 / 사진) */}
                    {diaryEditMode && (
                      isAddingEndOfDay ? (
                        <div style={{ marginTop: 8, marginBottom: 4 }}>
                          <textarea autoFocus placeholder="하루 총평을 남겨보세요..."
                            value={newBlockText} onChange={e => setNewBlockText(e.target.value)}
                            style={{ fontSize: 13, color: "#333", border: "1px solid #ddd", borderRadius: 8, padding: "10px 12px", width: "100%", outline: "none", resize: "vertical", lineHeight: 1.7, fontFamily: "inherit", minHeight: 72, boxSizing: "border-box" }}
                          />
                          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                            <button onClick={addTextBlock}
                              style={{ fontSize: 11, color: "#fff", background: "#1a1a1a", border: "none", borderRadius: 6, padding: "5px 14px", cursor: "pointer" }}>저장</button>
                            <button onClick={() => { setAddingInContext(null); setNewBlockText(""); }}
                              style={{ fontSize: 11, color: "#aaa", background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "5px 12px", cursor: "pointer" }}>취소</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                          <input
                            id={`diary-photo-date-${date}`}
                            type="file" accept="image/*"
                            style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", clip: "rect(0 0 0 0)", pointerEvents: "none" }}
                            onChange={async e => {
                              const f = e.target.files?.[0];
                              if (!f || uploadingDiaryImage) return;
                              setAddingImageContext({ eventId: null, date });
                              await addDiaryImageBlock(f, { eventId: null, date });
                              e.target.value = "";
                            }}
                          />
                          <button onClick={() => { setAddingInContext({ eventId: null, date }); setNewBlockText(""); }}
                            style={{ fontSize: 12, color: "#6b7280", background: "#F7F7F5", border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 4, minHeight: 36 }}>
                            📝 문단
                          </button>
                          <button
                            disabled={uploadingDiaryImage}
                            onClick={() => {
                              const inp = document.getElementById(`diary-photo-date-${date}`) as HTMLInputElement | null;
                              inp?.click();
                            }}
                            style={{ fontSize: 12, color: uploadingDiaryImage && addingImageContext?.date === date && addingImageContext?.eventId === null ? "#ccc" : "#6b7280", background: "#F7F7F5", border: "none", borderRadius: 8, padding: "7px 14px", cursor: uploadingDiaryImage ? "default" : "pointer", display: "flex", alignItems: "center", gap: 4, minHeight: 36 }}>
                            {uploadingDiaryImage && addingImageContext?.date === date && addingImageContext?.eventId === null ? "⏳ 업로드 중..." : "📷 사진"}
                          </button>
                        </div>
                      )
                    )}
                  </div>
                );
              })}

              {/* 고아 text 블록 (삭제된 이벤트에 연결된 문단) */}
              {(() => {
                const orphans = diaryBlocks.filter(b => (b.type === "text" || b.type === "image") && !renderedBlockIds.has(b.id));
                if (orphans.length === 0) return null;
                return (
                  <div style={{ marginTop: 40, paddingTop: 20, borderTop: "1px dashed #e0ddd8" }}>
                    <p style={{ fontSize: 11, color: "#bbb", margin: "0 0 12px" }}>삭제된 일정에 연결된 메모</p>
                    {orphans.map(block => (
                      <div key={block.id} style={{ marginBottom: 8, display: "flex", alignItems: "flex-start", gap: 10, justifyContent: "space-between", opacity: 0.65 }}>
                        <p style={{ fontSize: 13, color: "#555", margin: 0, lineHeight: 1.75, flex: 1, whiteSpace: "pre-wrap" }}>{block.content}</p>
                        {diaryEditMode && (
                          <button onClick={() => deleteBlock(block.id)}
                            style={{ fontSize: 11, color: "#e88", background: "none", border: "1px solid #f5d4d4", borderRadius: 4, padding: "2px 8px", cursor: "pointer", flexShrink: 0 }}>삭제</button>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* 다이어리 삭제 */}
              {diaryEditMode && (
                <div style={{ marginTop: 48, paddingTop: 20, borderTop: "1px solid #f0ede8", textAlign: "center" }}>
                  <button onClick={deleteDiary}
                    style={{ fontSize: 12, color: "#c55", background: "none", border: "1px solid #f5d4d4", borderRadius: 8, padding: "7px 18px", cursor: "pointer" }}>
                    다이어리 삭제
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  if (view === "home") {
    return (
      <div className="min-h-screen font-sans" style={{ background: "#F7F7F5" }}>

        {/* Header */}
        <div style={{ padding: "60px 20px 8px" }}>
          <p style={{ fontSize: 30, fontWeight: 700, color: "#111", margin: 0, letterSpacing: "-0.5px" }}>내 여행</p>
          {trips.length > 0 && (
            <p style={{ fontSize: 14, color: "#8E8E93", margin: "4px 0 0" }}>{trips.length}개</p>
          )}
        </div>

        {/* Trip list */}
        <div style={{ padding: "16px 16px 40px", display: "flex", flexDirection: "column", gap: 10, maxWidth: 560, margin: "0 auto" }}>

          {trips.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "#8E8E93" }}>
              <p style={{ fontSize: 40, margin: "0 0 12px" }}>✈️</p>
              <p style={{ fontSize: 16, fontWeight: 500, color: "#374151", margin: 0 }}>첫 여행을 시작해 보세요</p>
              <p style={{ fontSize: 14, color: "#8E8E93", margin: "6px 0 0" }}>아래 버튼을 눌러 새 여행을 만드세요</p>
            </div>
          )}

          {trips.map((trip, i) => {
            const days = trip.info.startDate && trip.info.endDate
              ? Math.round((new Date(trip.info.endDate).getTime() - new Date(trip.info.startDate).getTime()) / 86400000) + 1
              : 0;
            const isMenuOpen = menuOpen === i;

            return (
              <div
                key={trip.id}
                onClick={() => openTrip(trip)}
                style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 8px rgba(0,0,0,0.05)", cursor: "pointer", overflow: "visible", position: "relative", WebkitTapHighlightColor: "transparent" }}
              >
                <div style={{ padding: "16px 20px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {renamingId === trip.id ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenamingId(null); }}
                          onBlur={commitRename}
                          onClick={e => e.stopPropagation()}
                          style={{ fontSize: 17, fontWeight: 600, color: "#111", width: "100%", background: "none", border: "none", borderBottom: "1.5px solid #0A84FF", outline: "none", padding: "0 0 2px", fontFamily: "inherit" }}
                        />
                      ) : (
                        <p style={{ fontSize: 17, fontWeight: 600, color: "#111", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {trip.info.title}
                        </p>
                      )}
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
                        {trip.info.startDate && trip.info.endDate && (
                          <span style={{ fontSize: 13, color: "#8E8E93" }}>
                            {formatDateDisplay(trip.info.startDate)} — {formatDateDisplay(trip.info.endDate)}
                          </span>
                        )}
                        {days > 0 && (
                          <span style={{ fontSize: 12, color: "#0A84FF", fontWeight: 600, background: "rgba(10,132,255,0.08)", borderRadius: 6, padding: "1px 8px" }}>
                            {days}일
                          </span>
                        )}
                        {trip.cityStays.length > 0 && (
                          <span style={{ fontSize: 12, color: "#8E8E93" }}>
                            {trip.cityStays.map(s => s.name).filter(Boolean).join(" · ") || `${trip.cityStays.length}개 도시`}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Actions */}
                    <div style={{ flexShrink: 0, position: "relative" }}>
                      <button
                        onClick={e => { e.stopPropagation(); setMenuOpen(isMenuOpen ? null : i); }}
                        style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", cursor: "pointer", color: "#C7C7CC", fontSize: 18, borderRadius: 8 }}
                      >⋯</button>
                      {isMenuOpen && (
                        <div
                          onClick={e => e.stopPropagation()}
                          style={{ position: "absolute", top: 36, right: 0, background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", minWidth: 140, zIndex: 20, overflow: "hidden" }}
                        >
                          {[
                            { label: "이름 변경", action: () => { setRenameValue(trip.info.title); setRenamingId(trip.id); setMenuOpen(null); } },
                            { label: "공유 링크 복사", action: () => {
                              const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || window.location.origin;
                              navigator.clipboard.writeText(`${base}/?trip=${trip.id}`);
                              setCopiedTripId(trip.id);
                              setTimeout(() => setCopiedTripId(null), 2500);
                              setMenuOpen(null);
                            }},
                            { label: "복제", action: () => duplicateTrip(trip.id) },
                            ...(ownedTripIdsRef.current.has(trip.id)
                              ? [{ label: "삭제", action: () => deleteTrip(trip.id), danger: true }]
                              : []),
                          ].map(({ label, action, danger }) => (
                            <button
                              key={label}
                              onClick={action}
                              style={{ display: "block", width: "100%", textAlign: "left", padding: "13px 16px", fontSize: 14, color: (danger as boolean | undefined) ? "#FF453A" : "#111", background: "none", border: "none", cursor: "pointer", borderBottom: label === "복제" ? "1px solid rgba(0,0,0,0.06)" : "none" }}
                            >{label}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {/* Copied indicator */}
                {copiedTripId === trip.id && (
                  <div style={{ padding: "8px 20px 12px", borderTop: "1px solid rgba(0,0,0,0.04)" }}>
                    <p style={{ fontSize: 12, color: "#0A84FF", margin: 0 }}>✓ 링크가 복사됐습니다</p>
                  </div>
                )}
              </div>
            );
          })}

          {/* New trip button */}
          <button
            onClick={createNewTrip}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#fff", borderRadius: 16, padding: "16px 20px", border: "1.5px dashed rgba(0,0,0,0.15)", cursor: "pointer", color: "#0A84FF", fontSize: 15, fontWeight: 600, WebkitTapHighlightColor: "transparent" }}
          >
            <span style={{ fontSize: 20, lineHeight: 1 }}>+</span>
            <span>새 여행</span>
          </button>

        </div>
      </div>
    );
  }

  return (
    <div className="font-sans" style={{ height: "100dvh", display: "flex", flexDirection: "column", overflow: "hidden", background: "#F7F7F5" }}>
      {/* Header */}
      <header style={{ background: "#ffffff", borderBottom: "1px solid rgba(0,0,0,0.07)", padding: "0 16px", height: 52, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <button onClick={() => { setCurrentTripId(null); setView("home"); }} style={{ color: "#0A84FF", background: "none", border: "none", cursor: "pointer", fontSize: 17, fontWeight: 400, padding: "0 4px 0 0", flexShrink: 0, lineHeight: 1 }}>‹</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 17, fontWeight: 600, color: "#111", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tripInfo.title}</h1>
          {tripInfo.startDate && tripInfo.endDate && (
            <p style={{ fontSize: 12, color: "#8E8E93", margin: 0, marginTop: 1 }}>
              {formatDateDisplay(tripInfo.startDate)} — {formatDateDisplay(tripInfo.endDate)}{tripDays > 0 ? ` · ${tripDays}일` : ""}
            </p>
          )}
        </div>
        <button
          onClick={() => { setDiaryEditMode(false); setView("diary"); }}
          style={{ fontSize: 13, color: "#0A84FF", background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: "4px 0 4px 4px", fontWeight: 400 }}
        >다이어리</button>
        {!isMemberOfCurrentTrip && (
          showNicknamePrompt ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
              <input
                autoFocus
                placeholder="닉네임 (선택)"
                value={nicknameInput}
                onChange={e => setNicknameInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") joinTrip(); if (e.key === "Escape") setShowNicknamePrompt(false); }}
                style={{ fontSize: 11, border: "1px solid #ccc", borderRadius: 4, padding: "4px 8px", width: 90, outline: "none" }}
              />
              <button
                onClick={joinTrip}
                style={{ fontSize: 11, fontWeight: 500, background: "#0A84FF", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer", flexShrink: 0 }}
              >참여하기</button>
              <button
                onClick={() => setShowNicknamePrompt(false)}
                style={{ fontSize: 11, color: "#aaa", background: "none", border: "none", cursor: "pointer", padding: "6px 4px" }}
              >취소</button>
            </div>
          ) : (
            <button
              onClick={() => setShowNicknamePrompt(true)}
              style={{ fontSize: 11, fontWeight: 500, background: "#0A84FF", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", flexShrink: 0 }}
            >여행 참여하기</button>
          )
        )}
        {isMemberOfCurrentTrip && !isOwner && (
          <button
            onClick={() => setShowLeaveModal(true)}
            style={{ fontSize: 11, color: "#aaa", background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "5px 12px", cursor: "pointer", flexShrink: 0 }}
          >여행 나가기</button>
        )}
      </header>


      {/* ── 여행 계획 탭 ── */}
      {plannerTab === "plan" && (
      <div className="grid grid-cols-1 lg:grid-cols-[208px_1fr_256px] items-start gap-4 p-4 max-w-screen-xl mx-auto w-full pb-6 lg:pb-8" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>

        {/* ── 캘린더 — mobile: 1st | desktop: col-1 row-1 ── */}
        <div className="flex flex-col gap-3 order-1 lg:col-start-1 lg:row-start-1">
          {/* Mini calendar */}
          <div className="bg-white rounded-2xl p-4" style={{ border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 8px rgba(0,0,0,0.05)" }}>
            <div className="flex items-center justify-between mb-2">
              <button onClick={prevMonth} className="text-slate-400 hover:text-slate-600 px-1 text-sm leading-none">‹</button>
              <p className="text-xs font-semibold text-slate-600">{viewYear}년 {MONTH_NAMES[viewMonth]}</p>
              <button onClick={nextMonth} className="text-slate-400 hover:text-slate-600 px-1 text-sm leading-none">›</button>
            </div>
            <div className="grid grid-cols-7 gap-y-0.5 text-center">
              {WEEK_DAYS.map((d) => (
                <span key={d} className="text-[10px] font-medium text-slate-400 py-0.5">{d}</span>
              ))}
              {calCells.map((day, i) => {
                const isToday   = day === TODAY.day && viewYear === TODAY.year && viewMonth === TODAY.month;
                const isTrip    = day !== null && !!tripInfo.startDate && !!tripInfo.endDate &&
                  dateKey(viewYear, viewMonth, day) >= tripInfo.startDate &&
                  dateKey(viewYear, viewMonth, day) <= tripInfo.endDate;
                const isSelected = day === selectedDate.day && viewYear === selectedDate.year && viewMonth === selectedDate.month;
                const hasEvents  = day !== null && !!schedules[dateKey(viewYear, viewMonth, day)]?.length;
                return (
                  <span
                    key={i}
                    onClick={() => day !== null && setSelectedDate({ year: viewYear, month: viewMonth, day })}
                    className={[
                      "text-xs leading-none py-1.5 rounded-md transition-colors",
                      day === null ? "" : "cursor-pointer",
                      isSelected
                        ? "bg-[#0A84FF] text-white font-semibold"
                        : isToday
                        ? "ring-1 ring-stone-300 text-stone-700 font-semibold"
                        : isTrip || hasEvents
                        ? "bg-stone-50 text-stone-700 font-medium hover:bg-stone-100"
                        : day !== null
                        ? "text-slate-600 hover:bg-slate-50"
                        : "",
                    ].join(" ")}
                  >
                    {day ?? ""}
                  </span>
                );
              })}
            </div>
          </div>
        </div>{/* end: 캘린더 div */}

        {/* ── 여행정보 + 멤버 — mobile: 4th | desktop: col-1 row-2 ── */}
        <div className="flex flex-col gap-3 order-4 lg:col-start-1 lg:row-start-2">
          {/* Mobile accordion toggle */}
          <button
            className="lg:hidden w-full flex items-center justify-between bg-white rounded-2xl px-4"
            onClick={() => setShowTripPanel(p => !p)}
            style={{ height: 48, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", cursor: "pointer" }}
          >
            <span style={{ fontSize: 14, fontWeight: 500, color: "#111" }}>여행 정보 · 멤버</span>
            <span style={{ fontSize: 13, color: "#8E8E93", transition: "transform 200ms", display: "inline-block", transform: showTripPanel ? "rotate(180deg)" : "none" }}>⌄</span>
          </button>
          <div className={showTripPanel ? "flex flex-col gap-3" : "hidden lg:flex lg:flex-col lg:gap-3"}>
          {/* Trip summary */}
          <div className="bg-white rounded-2xl p-4" style={{ border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 8px rgba(0,0,0,0.05)" }}>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-[11px] text-stone-400 font-medium">여행 정보</p>
              {canEdit && (
                <button
                  onClick={() => setEditingTrip(v => !v)}
                  className="text-[10px] text-stone-500 hover:text-stone-700 font-medium"
                >
                  {editingTrip ? "완료" : "수정"}
                </button>
              )}
            </div>
            {editingTrip ? (
              <div className="space-y-2">
                <input
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-stone-300"
                  placeholder="여행 제목"
                  value={tripInfo.title}
                  onChange={e => setTripInfo(t => ({ ...t, title: e.target.value }))}
                />
                <div className="flex gap-1 items-center">
                  <input
                    type="date"
                    className="flex-1 min-w-0 text-xs border border-slate-200 rounded px-1.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-stone-300"
                    value={tripInfo.startDate}
                    onChange={e => setTripInfo(t => ({ ...t, startDate: e.target.value }))}
                  />
                  <span className="text-slate-300 shrink-0">–</span>
                  <input
                    type="date"
                    className="flex-1 min-w-0 text-xs border border-slate-200 rounded px-1.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-stone-300"
                    value={tripInfo.endDate}
                    onChange={e => setTripInfo(t => ({ ...t, endDate: e.target.value }))}
                  />
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">기간</span>
                  <span className="text-slate-700 font-medium">{tripDays > 0 ? `${tripDays}일` : "—"}</span>
                </div>
                {(["departure","returnFlight"] as const).map((key) => (
                  <select
                    key={key}
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-stone-300"
                    value={tripInfo[key]}
                    onChange={e => setTripInfo(t => ({ ...t, [key]: e.target.value }))}
                  >
                    {AIRPORTS.map(a => <option key={a.code} value={a.code}>{a.label}</option>)}
                  </select>
                ))}
                <input
                  className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-stone-300"
                  placeholder="숙소 (+ 로 구분)"
                  value={tripInfo.hotel}
                  onChange={e => setTripInfo(t => ({ ...t, hotel: e.target.value }))}
                />
                <div>
                  <p className="text-[11px] text-stone-400 mb-1">기본 통화 (경비 추가 시 기본 선택)</p>
                  <select
                    className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-stone-300"
                    value={tripInfo.currency ?? "KRW"}
                    onChange={e => setTripInfo(t => ({ ...t, currency: e.target.value }))}
                  >
                    {CURRENCY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                </div>

              </div>
            ) : (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">여행명</span>
                    <span className="text-slate-700 font-semibold text-right">{tripInfo.title}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">기간</span>
                    <span className="text-slate-700 font-medium">{tripDays}일</span>
                  </div>
                </div>
                <div className="pt-2.5" style={{ borderTop: "1px dashed rgba(0,0,0,0.08)" }}>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[11px] text-stone-400 font-medium mb-1">출발</p>
                      <p className="text-2xl font-bold text-stone-800 leading-none">{tripInfo.departure}</p>
                    </div>
                    <div className="flex-1 flex items-center px-2 pb-1.5">
                      <div className="flex-1 border-b border-dashed border-stone-200" />
                      <span className="text-stone-300 text-xs mx-1">›</span>
                      <div className="flex-1 border-b border-dashed border-stone-200" />
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] text-stone-400 font-medium mb-1">귀국</p>
                      <p className="text-2xl font-bold text-stone-800 leading-none">{tripInfo.returnFlight}</p>
                    </div>
                  </div>
                </div>
                <div className="pt-2.5 space-y-1.5" style={{ borderTop: "1px dashed rgba(0,0,0,0.08)" }}>
                  <p className="text-[11px] text-stone-400 font-medium">숙소</p>
                  <div className="flex flex-wrap gap-1">
                    {tripInfo.hotel.split("+").map(h => h.trim()).filter(Boolean).map(h => (
                      <span key={h} className="text-[10px] bg-stone-100 text-stone-600 border border-stone-200 px-1.5 py-0.5 rounded font-medium">{h}</span>
                    ))}
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* Members */}
          {members.length > 0 && (
            <div className="bg-white rounded-2xl p-4" style={{ border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 8px rgba(0,0,0,0.05)" }}>
              <p className="text-[11px] text-stone-400 font-medium mb-2.5">멤버</p>
              <div className="space-y-2">
                {members.map(m => {
                  const isMe = m.member_id === ownerIdRef.current;
                  const roleIcon = m.role === "owner" ? "👑" : m.role === "editor" ? "✏️" : "👀";
                  const baseName = m.nickname || (isMe ? "" : `#${m.member_id.slice(0, 6)}`);
                  const label = baseName ? `${baseName}${isMe ? " (나)" : ""}` : "(나)";
                  return (
                    <div key={m.member_id} className="flex items-center gap-2">
                      <span className="shrink-0 text-sm leading-none">{roleIcon}</span>
                      {isMe && editingNickname ? (
                        <input
                          autoFocus
                          value={nicknameEditValue}
                          onChange={e => setNicknameEditValue(e.target.value)}
                          onBlur={() => updateMyNickname(nicknameEditValue)}
                          onKeyDown={e => {
                            if (e.key === "Enter") updateMyNickname(nicknameEditValue);
                            if (e.key === "Escape") setEditingNickname(false);
                          }}
                          placeholder="닉네임"
                          className="flex-1 min-w-0 text-xs border-b border-slate-300 bg-transparent focus:outline-none py-0.5"
                        />
                      ) : (
                        <span
                          className="flex-1 min-w-0 text-xs text-slate-600 truncate"
                          style={isMe ? { cursor: "pointer" } : {}}
                          onClick={() => { if (isMe) { setNicknameEditValue(m.nickname || ""); setEditingNickname(true); } }}
                        >{label}</span>
                      )}
                      {isOwner && !isMe && (
                        <>
                          <select
                            value={m.role}
                            onChange={e => changeMemberRole(m.member_id, e.target.value)}
                            className="text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-500 focus:outline-none"
                          >
                            <option value="editor">편집자</option>
                            <option value="viewer">뷰어</option>
                          </select>
                          <button
                            onClick={() => removeMember(m.member_id)}
                            className="text-slate-300 hover:text-red-400 transition-colors text-base leading-none shrink-0"
                          >×</button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          </div>{/* end: accordion body */}
        </div>{/* end: 여행정보+멤버 div */}

        {/* ── 일정 — mobile: 2nd | desktop: col-2 row-1~2 ── */}
        <main className="order-2 lg:col-start-2 lg:row-start-1 lg:row-span-2 min-w-0 flex flex-col gap-3">
          <div className="bg-white rounded-2xl overflow-hidden" style={{ border: isToday ? "1.5px solid rgba(10,132,255,0.25)" : "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 8px rgba(0,0,0,0.05)" }}>
            {/* Day header */}
            <div className="flex items-center gap-3 px-5 py-4 bg-white" style={{ borderBottom: "1px dashed rgba(0,0,0,0.08)" }}>
              <div className="flex-1">
                <p className="text-[11px] text-stone-400 font-medium mb-0.5">일정</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-base font-semibold text-stone-800">
                    {getDateLabel(selectedDate.year, selectedDate.month, selectedDate.day)}
                  </span>
                  <span className="text-xs text-stone-400">
                    {getDayLabel(selectedDate.year, selectedDate.month, selectedDate.day)}
                  </span>
                </div>
                {/* 날짜별 진행률 */}
                {selEvents.length > 0 && (() => {
                  const done = selEvents.filter(e => e.completed).length;
                  const total = selEvents.length;
                  if (done === 0) return null;
                  const filled = Math.round(done / total * 10);
                  const bar = "█".repeat(filled) + "░".repeat(10 - filled);
                  return (
                    <div className="flex items-center gap-2 mt-1">
                      <span style={{ fontSize: 10, color: "#0A84FF", fontFamily: "monospace", letterSpacing: "-1px" }}>{bar}</span>
                      <span style={{ fontSize: 10, color: "#9ca3af" }}>{done}/{total} 완료</span>
                    </div>
                  );
                })()}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {isToday && <span className="text-[9px] uppercase tracking-widest font-semibold" style={{ color: "#0A84FF" }}>오늘</span>}
                {selEvents.some(e => e.location) && (
                  <button onClick={() => setShowRouteMap(true)} className="text-xs text-stone-400 hover:text-stone-600 transition-colors">🗺️ 동선</button>
                )}
                {canEdit && <button onClick={() => setShowForm(s => !s)} className="text-xs text-stone-400 hover:text-stone-600 transition-colors">+ 추가</button>}
              </div>
            </div>

            {/* Events */}
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={selEvents.map((_, ei) => String(ei))} strategy={verticalListSortingStrategy}>
                <div className="divide-y divide-slate-50">
                  {selEvents.map((ev, ei) => {
                    const next = selEvents[ei + 1];
                    return (
                      <SortableEventRow
                        key={ei}
                        id={String(ei)}
                        ev={ev}
                        isEditing={editing?.e === ei}
                        onSelect={() => {
                          if (!canEdit) return;
                          const ev = selEvents[ei];
                          setEditEventIdx(ei);
                          setEditForm({ time: ev.time, title: ev.title, tag: ev.tag, location: ev.location, booking_id: ev.booking_id ?? "" });
                          setShowEditEventSheet(true);
                        }}
                        nextLocation={next?.location}
                        onConfirm={(updated) => { updateEvent(ei, updated); setEditing(null); }}
                        onCancel={() => setEditing(null)}
                        onDelete={() => deleteEvent(ei)}
                        onToggleComplete={() => toggleEventComplete(ev.id)}
                        bookings={bookings}
                        bookingFiles={bookingFiles}
                        onOpenLightbox={(url) => setLightboxUrl(url)}
                        onGoToBooking={(bookingId) => { setPlannerTab("bookings"); setExpandedBookingId(bookingId); }}
                        records={eventRecords.filter(r => r.event_id === ev.id)}
                        userId={ownerIdRef.current}
                        canEdit={canEdit}
                        onAddMemo={(content) => addEventRecord(ev.id, "memo", content)}
                        onDeleteRecord={deleteEventRecord}
                        onUploadPhoto={(file) => uploadEventPhoto(ev.id, file)}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>

            {selEvents.length === 0 && (
              <p className="px-4 py-6 text-xs text-slate-400 text-center">일정이 없습니다</p>
            )}

            {/* 일정 추가 Bottom Sheet */}
            {showForm && typeof document !== "undefined" && createPortal(
              <div
                onClick={() => setShowForm(false)}
                style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.35)", overflow: "hidden" }}
              >
                <div
                  onClick={e => e.stopPropagation()}
                  style={{ position: "fixed", bottom: 0, left: 0, right: 0, width: "100%", maxWidth: "100vw", boxSizing: "border-box" as const, background: "#fff", borderRadius: "20px 20px 0 0", maxHeight: "88dvh", overflowX: "hidden", overflowY: "auto", touchAction: "pan-y", paddingBottom: "env(safe-area-inset-bottom)" }}
                >
                  {/* Handle */}
                  <div style={{ padding: "12px 0 4px", display: "flex", justifyContent: "center" }}>
                    <div style={{ width: 36, height: 4, borderRadius: 2, background: "#E5E5EA" }} />
                  </div>
                  {/* Header */}
                  <div style={{ padding: "8px 20px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <button onClick={() => setShowForm(false)} style={{ fontSize: 15, color: "#0A84FF", background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1 }}>취소</button>
                    <p style={{ fontSize: 16, fontWeight: 600, color: "#111", margin: 0 }}>
                      {getDateLabel(selectedDate.year, selectedDate.month, selectedDate.day)} 일정
                    </p>
                    <button
                      onClick={addEvent}
                      disabled={!form.title.trim()}
                      style={{ fontSize: 15, fontWeight: 600, color: form.title.trim() ? "#0A84FF" : "#C7C7CC", background: "none", border: "none", cursor: form.title.trim() ? "pointer" : "default", padding: 0, lineHeight: 1 }}
                    >추가</button>
                  </div>
                  {/* Form */}
                  <div style={{ padding: "0 20px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* 제목 — 전체 폭, 큰 텍스트 */}
                    <input
                      type="text"
                      placeholder="제목"
                      value={form.title}
                      onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && addEvent()}
                      autoFocus
                      style={{ fontSize: 20, fontWeight: 500, border: "none", borderBottom: "1.5px solid rgba(0,0,0,0.1)", outline: "none", padding: "2px 0 12px", background: "transparent", color: "#111", width: "100%", boxSizing: "border-box" as const, caretColor: "#0A84FF" }}
                    />
                    {/* 카테고리 — 칩 선택 (전체 폭 활용) */}
                    <div>
                      <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 8px", fontWeight: 500 }}>카테고리</p>
                      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                        {([
                          { value: "activity", label: "활동",   emoji: "📍" },
                          { value: "flight",   label: "항공편", emoji: "✈️" },
                          { value: "transit",  label: "이동",   emoji: "🚌" },
                          { value: "food",     label: "식사",   emoji: "🍽️" },
                          { value: "stay",     label: "숙박",   emoji: "🏨" },
                        ] as const).map(({ value, label, emoji }) => {
                          const sel = form.tag === value;
                          return (
                            <button
                              key={value}
                              onClick={() => setForm(f => ({ ...f, tag: value }))}
                              style={{ padding: "7px 14px", borderRadius: 20, border: `1.5px solid ${sel ? "#0A84FF" : "rgba(0,0,0,0.1)"}`, background: sel ? "rgba(10,132,255,0.07)" : "#fff", color: sel ? "#0A84FF" : "#374151", fontSize: 13, fontWeight: sel ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap", transition: "all 150ms" }}
                            >{emoji} {label}</button>
                          );
                        })}
                      </div>
                    </div>
                    {/* 시간 — 전체 폭 */}
                    <div>
                      <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 6px", fontWeight: 500 }}>시간</p>
                      <input
                        type="text"
                        placeholder="09:00"
                        value={form.time}
                        onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                        style={{ fontSize: 16, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "11px 14px", outline: "none", background: "#F7F7F5", width: "100%", boxSizing: "border-box" as const, color: "#111", fontFamily: "ui-monospace, monospace", caretColor: "#0A84FF" }}
                      />
                    </div>
                    {/* 장소 — 전체 폭, 큰 font-size */}
                    <div>
                      <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 6px", fontWeight: 500 }}>장소 (선택)</p>
                      <PlaceSearch
                        value={form.location}
                        onSelect={loc => setForm(f => ({ ...f, location: loc }))}
                        onClear={() => setForm(f => ({ ...f, location: undefined }))}
                      />
                    </div>
                    {/* 예약 연결 */}
                    {bookings.length > 0 && (
                      <div>
                        <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 6px", fontWeight: 500 }}>예약 연결 (선택)</p>
                        <select
                          value={form.booking_id}
                          onChange={e => setForm(f => ({ ...f, booking_id: e.target.value }))}
                          style={{ fontSize: 16, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "11px 14px", outline: "none", background: "#F7F7F5", width: "100%", boxSizing: "border-box" as const, color: "#111", appearance: "none" as const }}
                        >
                          <option value="">연결 안 함</option>
                          {[...bookings].sort((a, b) => (a.start_date ?? "zzz").localeCompare(b.start_date ?? "zzz")).map(b => (
                            <option key={b.id} value={b.id}>
                              {BOOKING_TYPE_CFG[b.type].emoji} {b.title}{b.start_date ? ` · ${fmtBookingDate(b.start_date)}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </div>,
              document.body
            )}
          {/* ── 일정 수정 Bottom Sheet ── */}
          {showEditEventSheet && editEventIdx !== null && typeof document !== "undefined" && createPortal(
            <div onClick={() => setShowEditEventSheet(false)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.35)", overflow: "hidden" }}>
              <div onClick={e => e.stopPropagation()} style={{ position: "fixed", bottom: 0, left: 0, right: 0, width: "100%", maxWidth: "100vw", boxSizing: "border-box" as const, background: "#fff", borderRadius: "20px 20px 0 0", maxHeight: "88dvh", overflowX: "hidden", overflowY: "auto", touchAction: "pan-y", paddingBottom: "env(safe-area-inset-bottom)" }}>
                <div style={{ padding: "12px 0 4px", display: "flex", justifyContent: "center" }}>
                  <div style={{ width: 36, height: 4, borderRadius: 2, background: "#E5E5EA" }} />
                </div>
                <div style={{ padding: "8px 20px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <button onClick={() => setShowEditEventSheet(false)} style={{ fontSize: 15, color: "#0A84FF", background: "none", border: "none", cursor: "pointer", padding: 0 }}>취소</button>
                  <p style={{ fontSize: 16, fontWeight: 600, color: "#111", margin: 0 }}>일정 수정</p>
                  <button
                    onClick={() => {
                      if (!editForm.title.trim() || editEventIdx === null) return;
                      const existing = selEvents[editEventIdx];
                      updateEvent(editEventIdx, { ...existing, ...editForm, booking_id: editForm.booking_id || null });
                      setShowEditEventSheet(false);
                      setEditing(null);
                    }}
                    style={{ fontSize: 15, fontWeight: 600, color: editForm.title.trim() ? "#0A84FF" : "#C7C7CC", background: "none", border: "none", cursor: editForm.title.trim() ? "pointer" : "default", padding: 0 }}
                  >저장</button>
                </div>
                <div style={{ padding: "0 20px 32px", display: "flex", flexDirection: "column", gap: 14 }}>
                  {/* 제목 */}
                  <input type="text" placeholder="제목" autoFocus value={editForm.title}
                    onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter" && editForm.title.trim() && editEventIdx !== null) { updateEvent(editEventIdx, { ...selEvents[editEventIdx], ...editForm, booking_id: editForm.booking_id || null }); setShowEditEventSheet(false); setEditing(null); } }}
                    style={{ fontSize: 20, fontWeight: 500, border: "none", borderBottom: "1.5px solid rgba(0,0,0,0.1)", outline: "none", padding: "2px 0 12px", background: "transparent", color: "#111", width: "100%", boxSizing: "border-box" as const, caretColor: "#0A84FF" }}
                  />
                  {/* 카테고리 칩 */}
                  <div>
                    <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 8px", fontWeight: 500 }}>카테고리</p>
                    <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                      {([
                        { value: "activity", label: "활동",   emoji: "📍" },
                        { value: "flight",   label: "항공편", emoji: "✈️" },
                        { value: "transit",  label: "이동",   emoji: "🚌" },
                        { value: "food",     label: "식사",   emoji: "🍽️" },
                        { value: "stay",     label: "숙박",   emoji: "🏨" },
                      ] as const).map(({ value, label, emoji }) => {
                        const sel = editForm.tag === value;
                        return (
                          <button key={value} onClick={() => setEditForm(f => ({ ...f, tag: value }))}
                            style={{ padding: "7px 14px", borderRadius: 20, border: `1.5px solid ${sel ? "#0A84FF" : "rgba(0,0,0,0.1)"}`, background: sel ? "rgba(10,132,255,0.07)" : "#fff", color: sel ? "#0A84FF" : "#374151", fontSize: 13, fontWeight: sel ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap", transition: "all 150ms" }}
                          >{emoji} {label}</button>
                        );
                      })}
                    </div>
                  </div>
                  {/* 시간 */}
                  <div>
                    <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 6px", fontWeight: 500 }}>시간</p>
                    <input type="text" placeholder="09:00" value={editForm.time}
                      onChange={e => setEditForm(f => ({ ...f, time: e.target.value }))}
                      style={{ fontSize: 16, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "11px 14px", outline: "none", background: "#F7F7F5", width: "100%", boxSizing: "border-box" as const, color: "#111", fontFamily: "ui-monospace, monospace", caretColor: "#0A84FF" }}
                    />
                  </div>
                  {/* 장소 */}
                  <div>
                    <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 6px", fontWeight: 500 }}>장소 (선택)</p>
                    <PlaceSearch
                      value={editForm.location}
                      onSelect={loc => setEditForm(f => ({ ...f, location: loc }))}
                      onClear={() => setEditForm(f => ({ ...f, location: undefined }))}
                    />
                  </div>
                  {/* 예약 연결 */}
                  {bookings.length > 0 && (
                    <div>
                      <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 6px", fontWeight: 500 }}>예약 연결 (선택)</p>
                      <select value={editForm.booking_id} onChange={e => setEditForm(f => ({ ...f, booking_id: e.target.value }))}
                        style={{ fontSize: 16, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "11px 14px", outline: "none", background: "#F7F7F5", width: "100%", boxSizing: "border-box" as const, color: "#111", appearance: "none" as const }}>
                        <option value="">연결 안 함</option>
                        {[...bookings].sort((a, b) => (a.start_date ?? "zzz").localeCompare(b.start_date ?? "zzz")).map(b => (
                          <option key={b.id} value={b.id}>{BOOKING_TYPE_CFG[b.type].emoji} {b.title}{b.start_date ? ` · ${fmtBookingDate(b.start_date)}` : ""}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {/* 삭제 */}
                  <button
                    onClick={() => { if (editEventIdx !== null) { deleteEvent(editEventIdx); setShowEditEventSheet(false); } }}
                    style={{ fontSize: 15, color: "#FF453A", background: "none", border: "1px solid rgba(255,69,58,0.2)", borderRadius: 12, padding: "12px", cursor: "pointer", marginTop: 8 }}
                  >일정 삭제</button>
                </div>
              </div>
            </div>,
            document.body
          )}

          {/* ── 경비 섹션 ── */}
          {(() => {
            const dayExpenses = expenses
              .filter(e => e.expense_date === selKey)
              .sort((a, b) => a.created_at.localeCompare(b.created_at));
            const isAdding = addingExpenseDate === selKey;

            const inlineFormStyle = { background: "#fafaf9", borderRadius: 8, padding: "10px 12px", border: "1px solid #e8e5e0" } as const;
            const inputStyle = { fontSize: 12, border: "1px solid #ddd", borderRadius: 6, padding: "4px 8px", outline: "none" } as const;
            const selectStyle = { fontSize: 12, border: "1px solid #ddd", borderRadius: 6, padding: "4px 6px", outline: "none", background: "#fff" } as const;

            return (
              <div style={{ borderTop: "1px dashed rgba(0,0,0,0.08)", padding: "12px 20px 16px" }}>
                <p style={{ fontSize: 11, color: "#aaa", margin: "0 0 10px", fontWeight: 600 }}>경비</p>

                {dayExpenses.map(exp => {
                  const linkedEvent = selEvents.find(e => e.id === exp.event_id);
                  const isEditing = editingExpenseId === exp.id;
                  return (
                    <div key={exp.id} style={{ marginBottom: 8 }}>
                      {isEditing ? (
                        /* ── 인라인 수정 폼 ── */
                        <div style={inlineFormStyle}>
                          <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                            <input type="number" step="0.01" autoFocus placeholder="0.00"
                              value={editExpenseForm.amount}
                              onChange={e => setEditExpenseForm(f => ({ ...f, amount: e.target.value }))}
                              onKeyDown={e => e.key === "Enter" && updateExpense()}
                              style={{ ...inputStyle, width: 80, fontSize: 13 }}
                            />
                            <select value={editExpenseForm.currency}
                              onChange={e => setEditExpenseForm(f => ({ ...f, currency: e.target.value }))}
                              style={{ ...selectStyle, width: 72 }}>
                              {CURRENCY_OPTIONS.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                            </select>
                            <select value={editExpenseForm.category}
                              onChange={e => setEditExpenseForm(f => ({ ...f, category: e.target.value }))}
                              style={{ ...selectStyle, flex: 1 }}>
                              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                                <option key={k} value={k}>{CATEGORY_ICON[k]} {v}</option>
                              ))}
                            </select>
                          </div>
                          <input placeholder="메모 (선택)"
                            value={editExpenseForm.memo}
                            onChange={e => setEditExpenseForm(f => ({ ...f, memo: e.target.value }))}
                            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 6, display: "block" }}
                          />
                          <select value={editExpenseForm.event_id}
                            onChange={e => setEditExpenseForm(f => ({ ...f, event_id: e.target.value }))}
                            style={{ ...selectStyle, width: "100%", boxSizing: "border-box", marginBottom: 8 }}>
                            <option value="">─ 일정 연결 안 함</option>
                            {selEvents.map(ev => <option key={ev.id} value={ev.id}>{ev.time} {ev.title}</option>)}
                          </select>
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                            <button onClick={() => setEditingExpenseId(null)}
                              style={{ fontSize: 11, color: "#aaa", background: "none", border: "1px solid #ddd", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>취소</button>
                            <button onClick={updateExpense}
                              style={{ fontSize: 11, color: "#fff", background: "#1a1a1a", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>저장</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{CATEGORY_ICON[exp.category]}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                              <span style={{ fontSize: 13, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {exp.memo || CATEGORY_LABEL[exp.category]}
                              </span>
                              <span style={{ fontSize: 13, fontWeight: 600, color: "#1a1a1a", flexShrink: 0 }}>
                                {formatAmount(Number(exp.amount), exp.currency)}
                              </span>
                            </div>
                            {linkedEvent && (
                              <p style={{ fontSize: 10, color: "#bbb", margin: "1px 0 0" }}>→ {linkedEvent.time} {linkedEvent.title}</p>
                            )}
                            {exp.nickname && (
                              <p style={{ fontSize: 10, color: "#0A84FF", margin: "1px 0 0" }}>{exp.nickname}</p>
                            )}
                          </div>
                          {canEdit && (
                            <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
                              <button onClick={() => {
                                setEditingExpenseId(exp.id);
                                setEditExpenseForm({ amount: String(exp.amount), currency: exp.currency, category: exp.category, memo: exp.memo ?? "", event_id: exp.event_id ?? "", payer: exp.payer ?? "", is_shared: exp.is_shared, participants: exp.participants ?? [] });
                              }}
                                style={{ fontSize: 10, color: "#888", background: "none", border: "1px solid #e8e5e0", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}>수정</button>
                              <button onClick={() => deleteExpense(exp.id)}
                                style={{ fontSize: 10, color: "#e88", background: "none", border: "1px solid #f5d4d4", borderRadius: 4, padding: "2px 6px", cursor: "pointer" }}>삭제</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {dayExpenses.length > 0 && !isAdding && (() => {
                  const byCur = dayExpenses.reduce((acc, e) => {
                    acc[e.currency] = (acc[e.currency] || 0) + Number(e.amount);
                    return acc;
                  }, {} as Record<string, number>);
                  const entries = Object.entries(byCur);
                  return (
                    <div style={{ padding: "7px 0", borderTop: "1px solid #f0ede8", marginBottom: 8 }}>
                      {entries.map(([cur, total], i) => (
                        <div key={cur} style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 11, color: "#aaa" }}>{i === 0 ? "일별 합계" : ""}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{formatAmount(total, cur)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {canEdit && (
                  <button
                    onClick={() => {
                      const prefs = (() => { try { return JSON.parse(localStorage.getItem(`expense-prefs-${currentTripId}`) ?? "{}"); } catch { return {}; } })();
                      setExpenseFormDate(selKey);
                      setExpenseForm({ amount: "", currency: prefs.currency ?? (tripInfo.currency ?? "KRW"), category: prefs.category ?? "other", memo: "", event_id: "", payer: prefs.payer ?? "", is_shared: false, participants: [] });
                      setShowExpenseSheet(true);
                    }}
                    style={{ fontSize: 13, color: "#0A84FF", background: "none", border: "1.5px dashed rgba(10,132,255,0.3)", borderRadius: 10, padding: "10px 0", cursor: "pointer", width: "100%", display: "block", fontWeight: 500 }}
                  >+ 경비 추가</button>
                )}
              </div>
            );
          })()}
          </div>
        </main>

        {/* ── 여정 요약 — mobile: 3rd | desktop: col-3 row-1~2 ── */}
        <aside className="order-3 lg:col-start-3 lg:row-start-1 lg:row-span-2">
          {/* Mobile accordion toggle for 여정 요약 */}
          <button
            className="lg:hidden w-full flex items-center justify-between bg-white rounded-2xl px-4 mb-3"
            onClick={() => setShowTripPanel(p => !p)}
            style={{ height: 48, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", cursor: "pointer" }}
          >
            <span style={{ fontSize: 14, fontWeight: 500, color: "#111" }}>여정 요약</span>
            <span style={{ fontSize: 13, color: "#8E8E93", transition: "transform 200ms", display: "inline-block", transform: showTripPanel ? "rotate(180deg)" : "none" }}>⌄</span>
          </button>
          <div className={showTripPanel ? "flex flex-col gap-3" : "hidden lg:block"}>
          <div className="bg-white rounded-2xl overflow-hidden sticky top-4" style={{ border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 8px rgba(0,0,0,0.05)" }}>
            <div className="px-4 pt-4 pb-3" style={{ borderBottom: "1px dashed rgba(0,0,0,0.07)" }}>
              <p className="text-[11px] text-stone-400 font-medium">여정 요약</p>
            </div>
            <div className="p-3 space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-3" style={{ borderBottom: "1px dashed rgba(0,0,0,0.07)" }}>
                {([
                  [tripDays > 0 ? String(tripDays) : "—", "일수"],
                  [cityStays.length ? String(cityStays.length) : "—", "도시"],
                  [cityStays.length > 1 ? String(cityStays.length - 1) : "—", "이동"],
                ] as [string, string][]).map(([val, lbl], i) => (
                  <div key={i} className="text-center py-4" style={i < 2 ? { borderRight: "1px dashed rgba(0,0,0,0.07)" } : {}}>
                    <p className="text-xl font-semibold text-stone-800">{val}</p>
                    <p className="text-[10px] text-stone-400 mt-0.5">{lbl}</p>
                  </div>
                ))}
              </div>

              {/* 완료 통계 */}
              {(() => {
                const allEvents = Object.values(schedules).flat();
                const total = allEvents.length;
                const done = allEvents.filter(e => e.completed).length;
                if (total === 0) return null;
                const pct = Math.round(done / total * 100);
                return (
                  <div style={{ borderBottom: "1px dashed rgba(0,0,0,0.07)", paddingBottom: 12 }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] text-stone-400 font-medium">방문 완료</p>
                      <span style={{ fontSize: 11, color: done > 0 ? "#0A84FF" : "#9ca3af", fontWeight: 600 }}>
                        {done} <span style={{ fontWeight: 400, color: "#9ca3af" }}>/ {total}</span>
                      </span>
                    </div>
                    <div style={{ height: 4, background: "#f0ede8", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: `${pct}%`,
                        background: "#34C759",
                        borderRadius: 2, transition: "width 400ms ease",
                      }} />
                    </div>
                    <p style={{ fontSize: 9, color: "#9ca3af", marginTop: 4, textAlign: "right" }}>{pct}%</p>
                  </div>
                );
              })()}

              {/* City stays — editable */}
              <div>
                <p className="text-[11px] text-stone-400 font-medium mb-2">도시별 체류</p>
                <div className="space-y-2">
                  {cityStays.map((stay, i) => {
                    const days = stay.startDate && stay.endDate
                      ? Math.round((new Date(stay.endDate).getTime() - new Date(stay.startDate).getTime()) / 86400000) + 1
                      : null;
                    const isActive = !!stay.startDate && !!stay.endDate && selKey >= stay.startDate && selKey <= stay.endDate;
                    return (
                      <div key={i} className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 transition-colors ${isActive ? "bg-[#0A84FF]" : "bg-stone-200"}`} />
                          <input
                            className="flex-1 min-w-0 text-xs font-medium text-slate-700 bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-stone-200 rounded px-1 py-0.5"
                            value={stay.name}
                            readOnly={!canEdit}
                            onChange={e => setCityStays(prev => prev.map((s, j) => j === i ? { ...s, name: e.target.value } : s))}
                          />
                          {days !== null && <span className="text-[10px] text-slate-400 shrink-0">{days}일</span>}
                          {canEdit && (
                            <button
                              className="text-slate-300 hover:text-red-400 transition-colors text-base leading-none shrink-0"
                              onClick={() => setCityStays(prev => prev.filter((_, j) => j !== i))}
                            >×</button>
                          )}
                        </div>
                        <div className="flex items-center gap-1 pl-4">
                          <input type="date"
                            className="flex-1 min-w-0 text-[10px] border border-slate-200 rounded px-1 py-0.5 text-slate-500 focus:outline-none focus:ring-1 focus:ring-stone-200"
                            value={stay.startDate}
                            readOnly={!canEdit}
                            onChange={e => setCityStays(prev => prev.map((s, j) => j === i ? { ...s, startDate: e.target.value } : s))}
                          />
                          <span className="text-slate-300 shrink-0 text-[10px]">–</span>
                          <input type="date"
                            className="flex-1 min-w-0 text-[10px] border border-slate-200 rounded px-1 py-0.5 text-slate-500 focus:outline-none focus:ring-1 focus:ring-stone-200"
                            value={stay.endDate}
                            readOnly={!canEdit}
                            onChange={e => setCityStays(prev => prev.map((s, j) => j === i ? { ...s, endDate: e.target.value } : s))}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {showCityForm ? (
                    <div className="space-y-1.5 pt-1 border-t border-slate-100">
                      <input
                        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-stone-300"
                        placeholder="도시 이름"
                        value={cityForm.name}
                        onChange={e => setCityForm(f => ({ ...f, name: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && addCity()}
                        autoFocus
                      />
                      <div className="flex items-center gap-1">
                        <input type="date"
                          className="flex-1 min-w-0 text-[10px] border border-slate-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-stone-300"
                          value={cityForm.startDate}
                          onChange={e => setCityForm(f => ({ ...f, startDate: e.target.value }))}
                        />
                        <span className="text-slate-300 text-[10px]">–</span>
                        <input type="date"
                          className="flex-1 min-w-0 text-[10px] border border-slate-200 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-stone-300"
                          value={cityForm.endDate}
                          onChange={e => setCityForm(f => ({ ...f, endDate: e.target.value }))}
                        />
                      </div>
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setShowCityForm(false)} className="text-[10px] text-slate-400 hover:text-slate-600 px-2 py-1">취소</button>
                        <button onClick={addCity} className="text-[10px] bg-[#0A84FF] text-white px-2.5 py-1 rounded hover:bg-[#0071e3]">추가</button>
                      </div>
                    </div>
                  ) : canEdit ? (
                    <button
                      onClick={() => setShowCityForm(true)}
                      className="w-full text-[10px] text-slate-400 hover:text-slate-600 py-1.5 border border-dashed border-slate-200 rounded hover:border-slate-300 transition-colors"
                    >+ 도시 추가</button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          {/* ── 경비 요약 카드 ── */}
          {expenses.length > 0 && (() => {
            // 통화별 그룹: { GBP: { total, byDate, byCat }, DKK: ... }
            const curGroups: Record<string, { total: number; byDate: Record<string, number>; byCat: Record<string, number> }> = {};
            for (const e of expenses) {
              const cur = e.currency;
              if (!curGroups[cur]) curGroups[cur] = { total: 0, byDate: {}, byCat: {} };
              curGroups[cur].total += Number(e.amount);
              curGroups[cur].byDate[e.expense_date] = (curGroups[cur].byDate[e.expense_date] || 0) + Number(e.amount);
              curGroups[cur].byCat[e.category] = (curGroups[cur].byCat[e.category] || 0) + Number(e.amount);
            }
            // 날짜별×통화별 행 (날짜 오름차순, 같은 날짜 내 통화 오름차순)
            const dateCurRows: { date: string; cur: string; total: number }[] = [];
            for (const [cur, g] of Object.entries(curGroups)) {
              for (const [date, total] of Object.entries(g.byDate)) {
                dateCurRows.push({ date, cur, total });
              }
            }
            dateCurRows.sort((a, b) => a.date.localeCompare(b.date) || a.cur.localeCompare(b.cur));

            // 카테고리×통화 행 (금액 내림차순)
            const catCurRows: { cat: string; cur: string; total: number }[] = [];
            for (const [cur, g] of Object.entries(curGroups)) {
              for (const [cat, total] of Object.entries(g.byCat)) {
                catCurRows.push({ cat, cur, total });
              }
            }
            catCurRows.sort((a, b) => b.total - a.total);

            const currencies = Object.keys(curGroups).sort();

            return (
              <div className="bg-white rounded-2xl p-4 mt-3" style={{ border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 8px rgba(0,0,0,0.05)" }}>
                <div className="pb-2 mb-2" style={{ borderBottom: "1px dashed rgba(0,0,0,0.07)" }}>
                  <p className="text-[11px] text-stone-400 font-medium">경비 요약</p>
                </div>
                <div className="space-y-1 mb-2">
                  {dateCurRows.map(({ date, cur, total }, i) => (
                    <div key={`${date}-${cur}`} className="flex justify-between text-xs">
                      <span className="text-slate-400">
                        {i === 0 || dateCurRows[i - 1].date !== date ? formatDateDisplay(date) : ""}
                      </span>
                      <span className="text-slate-600">{formatAmount(total, cur)}</span>
                    </div>
                  ))}
                </div>
                <div className="py-2 mb-2" style={{ borderTop: "1px solid #f0ede8", borderBottom: "1px solid #f0ede8" }}>
                  {currencies.map(cur => (
                    <div key={cur} className="flex justify-between text-xs">
                      <span className="font-semibold text-slate-600">{currencies.length === 1 ? "전체 합계" : `합계 (${cur})`}</span>
                      <span className="font-bold text-slate-800">{formatAmount(curGroups[cur].total, cur)}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-0.5">
                  {catCurRows.map(({ cat, cur, total }) => (
                    <div key={`${cat}-${cur}`} className="flex justify-between" style={{ fontSize: 10 }}>
                      <span className="text-slate-400">{CATEGORY_ICON[cat]} {CATEGORY_LABEL[cat]}</span>
                      <span className="text-slate-600">{formatAmount(total, cur)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          </div>{/* end: aside accordion body */}
        </aside>

      </div>
      )} {/* end: 여행 계획 탭 */}

      {/* ── 체크리스트 탭 ── */}
      {plannerTab === "checklist" && (() => {
        const done = checklistItems.filter(x => x.checked).length;
        const total = checklistItems.length;
        const pct = total > 0 ? Math.round(done / total * 100) : 0;
        return (
          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 16px 32px", maxWidth: 560, margin: "0 auto", width: "100%" }}>
            {/* 진행률 헤더 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", margin: 0 }}>준비물 체크리스트</p>
                <span style={{ fontSize: 13, color: done === total && total > 0 ? "#34C759" : "#9ca3af", fontWeight: 600 }}>
                  {done} <span style={{ fontWeight: 400, color: "#bbb" }}>/ {total}</span>
                </span>
              </div>
              {total > 0 && (
                <>
                  <div style={{ height: 5, background: "#f0ede8", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${pct}%`,
                      background: "#34C759",
                      borderRadius: 3, transition: "width 400ms ease",
                    }} />
                  </div>
                  <p style={{ fontSize: 10, color: "#9ca3af", textAlign: "right", marginTop: 4 }}>{pct}%</p>
                </>
              )}
            </div>

            {/* 항목 목록 */}
            {(() => {
              const unchecked = checklistItems.filter(x => !x.checked).sort((a, b) => a.position - b.position);
              const checked   = checklistItems.filter(x => x.checked).sort((a, b) => a.position - b.position);
              const renderRow = (item: ChecklistItem, isLast: boolean) => (
                <div
                  key={item.id}
                  onClick={() => { if (canEdit) toggleChecklistItem(item.id, !item.checked); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 14,
                    padding: "14px 16px",
                    borderBottom: isLast ? "none" : "1px solid rgba(0,0,0,0.05)",
                    background: item.checked ? "#fafaf9" : "#fff",
                    cursor: canEdit ? "pointer" : "default",
                    transition: "background 150ms",
                    minHeight: 56,
                    userSelect: "none" as const,
                  }}
                >
                  <div style={{
                    width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                    border: item.checked ? "none" : "2px solid #d1d5db",
                    background: item.checked ? "#34C759" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    transition: "all 200ms",
                  }}>
                    {item.checked && <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                  </div>
                  <span style={{
                    flex: 1, fontSize: 15, lineHeight: 1.4,
                    color: item.checked ? "#9ca3af" : "#1a1a1a",
                    textDecoration: item.checked ? "line-through" : "none",
                    textDecorationColor: "#9ca3af",
                    transition: "color 200ms",
                  }}>{item.text}</span>
                  {canEdit && (
                    <button onClick={e => { e.stopPropagation(); deleteChecklistItem(item.id); }}
                      style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, border: "none", background: "none", color: "#d1d5db", fontSize: 20, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                    >×</button>
                  )}
                </div>
              );
              return (
                <>
                  {/* 미완료 항목 */}
                  {checklistItems.length === 0 ? (
                    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)", marginBottom: 12 }}>
                      <p style={{ padding: "40px 20px", textAlign: "center", color: "#9ca3af", fontSize: 13, margin: 0 }}>항목을 추가해주세요</p>
                    </div>
                  ) : (
                    <>
                      {unchecked.length > 0 && (
                        <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)", marginBottom: 12 }}>
                          {unchecked.map((item, i) => renderRow(item, i === unchecked.length - 1))}
                        </div>
                      )}
                      {/* 구분선 */}
                      {unchecked.length > 0 && checked.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, padding: "0 2px" }}>
                          <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.07)" }} />
                          <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 500 }}>완료 {checked.length}</span>
                          <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,0.07)" }} />
                        </div>
                      )}
                      {/* 완료 항목 */}
                      {checked.length > 0 && (
                        <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 6px rgba(0,0,0,0.04)", marginBottom: 12 }}>
                          {checked.map((item, i) => renderRow(item, i === checked.length - 1))}
                        </div>
                      )}
                    </>
                  )}
                </>
              );
            })()}

            {/* 추가 입력 */}
            {canEdit && (
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  placeholder="준비물 추가..."
                  value={checklistNewText}
                  onChange={e => setChecklistNewText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addChecklistItem(); }}
                  style={{
                    flex: 1, fontSize: 15, padding: "13px 16px",
                    border: "1px solid #e5e7eb", borderRadius: 12, outline: "none",
                    background: "#fff", fontFamily: "inherit",
                  }}
                />
                <button
                  onClick={addChecklistItem}
                  disabled={!checklistNewText.trim()}
                  style={{
                    fontSize: 14, fontWeight: 600, padding: "13px 20px",
                    color: "#fff", background: checklistNewText.trim() ? "#0A84FF" : "#d1d5db",
                    border: "none", borderRadius: 12, cursor: checklistNewText.trim() ? "pointer" : "default",
                    flexShrink: 0, transition: "background 150ms", fontFamily: "inherit",
                  }}
                >추가</button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── 예약 탭 ── */}
      {plannerTab === "bookings" && (() => {
        const sorted = [...bookings].sort((a, b) => {
          if (!a.start_date && !b.start_date) return 0;
          if (!a.start_date) return 1;
          if (!b.start_date) return -1;
          if (a.start_date !== b.start_date) return a.start_date.localeCompare(b.start_date);
          return (a.start_time ?? "").localeCompare(b.start_time ?? "");
        });
        const filtered = sorted.filter(b => bookingFilter === "all" || b.type === bookingFilter);

        // 날짜별 그룹
        const byDate = new Map<string, Booking[]>();
        sorted.filter(b => bookingFilter === "all" || b.type === bookingFilter).forEach(b => {
          const key = b.start_date ?? "__";
          if (!byDate.has(key)) byDate.set(key, []);
          byDate.get(key)!.push(b);
        });
        const dateKeys = [...byDate.keys()].sort((a, b) => a === "__" ? 1 : b === "__" ? -1 : a.localeCompare(b));

        const inputStyle: React.CSSProperties = {
          width: "100%", boxSizing: "border-box",
          fontSize: 16, padding: "13px 14px",
          border: "1px solid #e5e7eb", borderRadius: 12,
          outline: "none", background: "#fff", fontFamily: "inherit",
          display: "block",
        };

        const BookingCard = (b: Booking) => {
          const cfg = BOOKING_TYPE_CFG[b.type];
          const files = bookingFiles.filter(f => f.booking_id === b.id);
          const isExpanded = expandedBookingId === b.id;
          const range = fmtBookingRange(b);
          return (
            <div key={b.id} style={{ background: "#fff", borderRadius: 16, border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", marginBottom: 10, overflow: "hidden" }}>
              {/* 카드 헤더 — 항상 표시, 탭하면 펼침 */}
              <div
                onClick={() => setExpandedBookingId(x => x === b.id ? null : b.id)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", cursor: "pointer", userSelect: "none" }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 12, background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>
                  {cfg.emoji}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.title}</p>
                  {(b.provider || range) && (
                    <p style={{ fontSize: 12, color: "#9ca3af", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[b.provider, range].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {/* 빠른 접근 아이콘 미리보기 */}
                  {(b.link || files.length > 0) && (
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      {b.link && <span style={{ fontSize: 11, color: "#0A84FF" }}>🔗 링크</span>}
                      {files.filter(f => f.mime.startsWith("image/")).length > 0 && (
                        <span style={{ fontSize: 11, color: "#0A84FF" }}>🖼️ ×{files.filter(f => f.mime.startsWith("image/")).length}</span>
                      )}
                      {files.filter(f => f.mime === "application/pdf").length > 0 && (
                        <span style={{ fontSize: 11, color: "#0A84FF" }}>📄 ×{files.filter(f => f.mime === "application/pdf").length}</span>
                      )}
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 18, color: "#d1d5db", flexShrink: 0 }}>{isExpanded ? "∨" : "›"}</span>
              </div>

              {/* 펼쳐진 상세 */}
              {isExpanded && (
                <div style={{ borderTop: "1px solid rgba(0,0,0,0.05)", padding: "14px 16px 16px" }}>
                  {/* 날짜/시간 */}
                  {range && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                      <span style={{ fontSize: 13 }}>📅</span>
                      <span style={{ fontSize: 14, color: "#374151" }}>{range}</span>
                    </div>
                  )}
                  {/* 링크 */}
                  {b.link && (
                    <button
                      onClick={() => window.open(b.link!, "_blank")}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "11px 14px", marginBottom: 12, background: "rgba(10,132,255,0.07)", border: "1px solid rgba(10,132,255,0.3)", borderRadius: 10, cursor: "pointer", textAlign: "left" }}
                    >
                      <span style={{ fontSize: 15 }}>🔗</span>
                      <span style={{ flex: 1, fontSize: 14, color: "#059669", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>예약 확인하기 ↗</span>
                    </button>
                  )}
                  {/* 첨부파일 */}
                  {(files.length > 0 || canEdit) && (
                    <div style={{ marginBottom: 12 }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>첨부파일</p>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                        {files.map(f => {
                          const isImg = f.mime.startsWith("image/");
                          return (
                            <div key={f.id} style={{ position: "relative" }}>
                              <button
                                onClick={() => isImg ? setLightboxUrl(f.url) : window.open(f.url, "_blank")}
                                style={{ width: "100%", aspectRatio: "1", borderRadius: 10, overflow: "hidden", border: "1px solid #f0ede8", background: "#fafaf9", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 0 }}
                              >
                                {isImg ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={f.url} alt={f.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                ) : (
                                  <>
                                    <span style={{ fontSize: 26 }}>📄</span>
                                    <span style={{ fontSize: 9, color: "#9ca3af", padding: "0 4px", textAlign: "center", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", marginTop: 3 }}>{f.name}</span>
                                  </>
                                )}
                              </button>
                              {canEdit && (
                                <button onClick={() => deleteBookingFile(f)} style={{ position: "absolute", top: 4, right: 4, width: 20, height: 20, borderRadius: "50%", background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>×</button>
                              )}
                            </div>
                          );
                        })}
                        {canEdit && (
                          <label style={{ aspectRatio: "1", borderRadius: 10, border: "2px dashed #d1d5db", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", background: "#fafaf9", gap: 3 }}>
                            <input type="file" accept="image/*,application/pdf" multiple
                              style={{ display: "none" }}
                              onChange={async e => {
                                const fs = Array.from(e.target.files ?? []);
                                for (const f of fs) await uploadBookingFile(b.id, f);
                                e.target.value = "";
                              }}
                            />
                            {uploadingBookingId === b.id
                              ? <span style={{ fontSize: 10, color: "#9ca3af" }}>업로드 중…</span>
                              : <><span style={{ fontSize: 22, color: "#d1d5db" }}>+</span><span style={{ fontSize: 10, color: "#9ca3af" }}>사진/PDF</span></>
                            }
                          </label>
                        )}
                      </div>
                    </div>
                  )}
                  {/* 메모 */}
                  {b.memo && (
                    <div style={{ background: "#fafaf9", borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
                      <p style={{ fontSize: 13, color: "#374151", margin: 0, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{b.memo}</p>
                    </div>
                  )}
                  {/* 선택 정보 */}
                  {(b.provider || b.booking_ref) && (
                    <p style={{ fontSize: 12, color: "#9ca3af", margin: "0 0 12px" }}>
                      {[b.provider, b.booking_ref].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {/* 수정/삭제 */}
                  {canEdit && (
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button onClick={() => { setEditingBooking(b); setBookingForm({ type: b.type, title: b.title, start_date: b.start_date ?? "", start_time: b.start_time ?? "", end_date: b.end_date ?? "", end_time: b.end_time ?? "", link: b.link ?? "", memo: b.memo ?? "", provider: b.provider ?? "", booking_ref: b.booking_ref ?? "", event_link_id: "" }); setShowBookingSheet(true); }}
                        style={{ fontSize: 13, color: "#6b7280", background: "none", border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 16px", cursor: "pointer" }}>✏️ 수정</button>
                      <button onClick={() => { if (confirm(`"${b.title}" 예약을 삭제할까요?`)) deleteBooking(b.id); }}
                        style={{ fontSize: 13, color: "#ef4444", background: "none", border: "1px solid #fee2e2", borderRadius: 8, padding: "7px 16px", cursor: "pointer" }}>🗑️ 삭제</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        };

        return (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
            {/* 보기 전환 + 필터 */}
            <div style={{ background: "#fff", borderBottom: "1px solid rgba(0,0,0,0.06)", padding: "10px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, overflowX: "auto", scrollbarWidth: "none" }}>
              {/* 보기 토글 */}
              <div style={{ display: "flex", background: "#f3f4f6", borderRadius: 8, padding: 2, flexShrink: 0 }}>
                {(["date", "category"] as const).map(v => (
                  <button key={v} onClick={() => setBookingView(v)}
                    style={{ padding: "5px 12px", fontSize: 12, fontWeight: bookingView === v ? 600 : 400, color: bookingView === v ? "#1a1a1a" : "#9ca3af", background: bookingView === v ? "#fff" : "transparent", border: "none", borderRadius: 6, cursor: "pointer", whiteSpace: "nowrap" }}>
                    {v === "date" ? "날짜별" : "카테고리별"}
                  </button>
                ))}
              </div>
              {/* 카테고리 필터 */}
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {([["all","전체"], ...Object.entries(BOOKING_TYPE_CFG).map(([k, v]) => [k, v.emoji])] as [string, string][]).map(([type, label]) => (
                  <button key={type} onClick={() => setBookingFilter(type as "all" | BookingType)}
                    style={{ padding: "5px 12px", fontSize: 13, borderRadius: 20, border: "1px solid", borderColor: bookingFilter === type ? "#0A84FF" : "#e5e7eb", background: bookingFilter === type ? "rgba(10,132,255,0.07)" : "#fff", color: bookingFilter === type ? "#0A84FF" : "#6b7280", cursor: "pointer", whiteSpace: "nowrap", fontWeight: bookingFilter === type ? 600 : 400 }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 카드 목록 */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px 32px" }}>
              {filtered.length === 0 && (
                <div style={{ textAlign: "center", padding: "60px 20px", color: "#9ca3af" }}>
                  <p style={{ fontSize: 32, marginBottom: 8 }}>📋</p>
                  <p style={{ fontSize: 14, margin: 0 }}>예약이 없습니다</p>
                  <p style={{ fontSize: 12, margin: "4px 0 0" }}>아래 + 버튼으로 추가하세요</p>
                </div>
              )}

              {bookingView === "date" ? (
                dateKeys.map(dk => (
                  <div key={dk}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af", margin: "16px 0 8px", paddingBottom: 6, borderBottom: "1px solid #f0ede8" }}>
                      {dk === "__" ? "날짜 미정" : fmtBookingDate(dk)}
                    </p>
                    {byDate.get(dk)!.map(b => BookingCard(b))}
                  </div>
                ))
              ) : (
                (Object.entries(BOOKING_TYPE_CFG) as [BookingType, typeof BOOKING_TYPE_CFG[BookingType]][]).map(([type, cfg]) => {
                  const items = filtered.filter(b => b.type === type);
                  if (items.length === 0) return null;
                  return (
                    <div key={type}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af", margin: "16px 0 8px", paddingBottom: 6, borderBottom: "1px solid #f0ede8" }}>
                        {cfg.emoji} {cfg.label} ({items.length})
                      </p>
                      {items.map(b => BookingCard(b))}
                    </div>
                  );
                })
              )}
            </div>

            {/* FAB */}
            {canEdit && (
              <button
                onClick={() => { setEditingBooking(null); setBookingForm(BOOKING_FORM_INIT); setShowBookingSheet(true); }}
                style={{ position: "fixed", bottom: "calc(env(safe-area-inset-bottom) + 72px)", right: 20, zIndex: 100, width: 52, height: 52, borderRadius: "50%", background: "#0A84FF", color: "#fff", border: "none", fontSize: 26, lineHeight: 1, cursor: "pointer", boxShadow: "0 4px 18px rgba(10,132,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
              >+</button>
            )}

            {/* 바텀 시트 */}
            {showBookingSheet && typeof document !== "undefined" && createPortal(
              <div
                onClick={() => { setShowBookingSheet(false); setEditingBooking(null); setBookingForm(BOOKING_FORM_INIT); }}
                style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.4)", overflow: "hidden" }}
              >
                <div
                  onClick={e => e.stopPropagation()}
                  style={{ position: "fixed", bottom: 0, left: 0, right: 0, width: "100%", maxWidth: "100vw", boxSizing: "border-box" as const, background: "#fff", borderRadius: "20px 20px 0 0", maxHeight: "92dvh", overflowX: "hidden", overflowY: "auto", touchAction: "pan-y" }}
                >
                  {/* 핸들 */}
                  <div style={{ padding: "12px 0 0", display: "flex", justifyContent: "center" }}>
                    <div style={{ width: 36, height: 4, borderRadius: 2, background: "#e5e7eb" }} />
                  </div>
                  {/* 헤더 */}
                  <div style={{ padding: "14px 20px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <p style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{editingBooking ? "예약 수정" : "예약 추가"}</p>
                    <button onClick={() => { setShowBookingSheet(false); setEditingBooking(null); setBookingForm(BOOKING_FORM_INIT); }} style={{ fontSize: 22, color: "#9ca3af", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
                  </div>
                  {/* 폼 */}
                  <div style={{ padding: "16px 20px 40px" }}>
                    {/* 종류 선택 */}
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 8px" }}>종류</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 20 }}>
                      {(Object.entries(BOOKING_TYPE_CFG) as [BookingType, typeof BOOKING_TYPE_CFG[BookingType]][]).map(([type, cfg]) => (
                        <button key={type} onClick={() => setBookingForm(f => ({ ...f, type }))}
                          style={{ padding: "12px 4px", borderRadius: 12, border: `2px solid ${bookingForm.type === type ? "#0A84FF" : "#f0ede8"}`, background: bookingForm.type === type ? cfg.bg : "#fff", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 24 }}>{cfg.emoji}</span>
                          <span style={{ fontSize: 11, color: bookingForm.type === type ? cfg.text : "#9ca3af", fontWeight: 600 }}>{cfg.label}</span>
                        </button>
                      ))}
                    </div>

                    {/* 제목 */}
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>제목 <span style={{ color: "#ef4444" }}>*</span></p>
                    <input style={{ ...inputStyle, marginBottom: 16 }} placeholder="예: 바르셀로나행 항공권" value={bookingForm.title} onChange={e => setBookingForm(f => ({ ...f, title: e.target.value }))} onKeyDown={e => e.key === "Enter" && saveBooking()} />

                    {/* 날짜/시간 */}
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>날짜 <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af" }}>(선택)</span></p>
                    <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                      <input type="date" style={{ ...inputStyle, flex: 1 }} value={bookingForm.start_date} onChange={e => setBookingForm(f => ({ ...f, start_date: e.target.value }))} />
                      <input type="text" placeholder="09:00" style={{ ...inputStyle, width: 90, flex: "none", textAlign: "center" }} value={bookingForm.start_time} onChange={e => setBookingForm(f => ({ ...f, start_time: e.target.value }))} />
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
                      <span style={{ fontSize: 13, color: "#9ca3af", flexShrink: 0 }}>종료</span>
                      <input type="date" style={{ ...inputStyle, flex: 1 }} value={bookingForm.end_date} onChange={e => setBookingForm(f => ({ ...f, end_date: e.target.value }))} />
                      <input type="text" placeholder="14:30" style={{ ...inputStyle, width: 90, flex: "none", textAlign: "center" }} value={bookingForm.end_time} onChange={e => setBookingForm(f => ({ ...f, end_time: e.target.value }))} />
                    </div>

                    {/* 링크 */}
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>예약 링크 <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af" }}>(선택)</span></p>
                    <input type="url" style={{ ...inputStyle, marginBottom: 20 }} placeholder="https://..." value={bookingForm.link} onChange={e => setBookingForm(f => ({ ...f, link: e.target.value }))} />

                    {/* 선택 정보 */}
                    <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>업체명 <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af" }}>(선택)</span></p>
                        <input style={inputStyle} placeholder="이베리아항공" value={bookingForm.provider} onChange={e => setBookingForm(f => ({ ...f, provider: e.target.value }))} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>예약번호 <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af" }}>(선택)</span></p>
                        <input style={inputStyle} placeholder="IB3456" value={bookingForm.booking_ref} onChange={e => setBookingForm(f => ({ ...f, booking_ref: e.target.value }))} />
                      </div>
                    </div>

                    {/* 일정 연결 — 생성 시에만 */}
                    {!editingBooking && (() => {
                      const allEvents = Object.entries(schedules)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .flatMap(([date, evs]) => evs.map(ev => ({ ...ev, date })));
                      if (allEvents.length === 0) return null;
                      return (
                        <>
                          <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>일정 연결 <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af" }}>(선택)</span></p>
                          <select
                            style={{ ...inputStyle, marginBottom: 16 }}
                            value={bookingForm.event_link_id}
                            onChange={e => setBookingForm(f => ({ ...f, event_link_id: e.target.value }))}
                          >
                            <option value="">── 일정 연결 안 함</option>
                            {allEvents.map(ev => (
                              <option key={ev.id} value={ev.id}>
                                {fmtBookingDate(ev.date)} {ev.time} {tagEmoji[ev.tag] ? `${tagEmoji[ev.tag]} ` : ""}{ev.title}
                              </option>
                            ))}
                          </select>
                        </>
                      );
                    })()}

                    {/* 메모 */}
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", margin: "0 0 6px" }}>메모 <span style={{ fontSize: 11, fontWeight: 400, color: "#9ca3af" }}>(선택)</span></p>
                    <textarea rows={3} style={{ ...inputStyle, resize: "none", marginBottom: 24 }} placeholder="위탁수하물 23kg 포함, 좌석 12A..." value={bookingForm.memo} onChange={e => setBookingForm(f => ({ ...f, memo: e.target.value }))} />

                    {/* 저장 버튼 */}
                    <button
                      onClick={saveBooking}
                      disabled={!bookingForm.title.trim()}
                      style={{ width: "100%", padding: "15px", fontSize: 16, fontWeight: 700, color: "#fff", background: bookingForm.title.trim() ? "#0A84FF" : "#d1d5db", border: "none", borderRadius: 14, cursor: bookingForm.title.trim() ? "pointer" : "default" }}
                    >저장하기</button>
                  </div>
                </div>
              </div>,
              document.body
            )}

          </div>
        );
      })()}

      {/* ── 경비 탭 ── */}
      {plannerTab === "expenses" && (() => {
        const xRates = tripInfo.exchangeRates ?? {};
        const baseCur = tripInfo.currency || "KRW";

        const allExpByCur: Record<string, number> = {};
        const sharedByCur: Record<string, number> = {};
        const personalByCur: Record<string, number> = {};
        for (const e of expenses) {
          const amt = Number(e.amount);
          allExpByCur[e.currency] = (allExpByCur[e.currency] ?? 0) + amt;
          if (e.is_shared) sharedByCur[e.currency] = (sharedByCur[e.currency] ?? 0) + amt;
          else personalByCur[e.currency] = (personalByCur[e.currency] ?? 0) + amt;
        }

        const byDate: Record<string, Expense[]> = {};
        for (const e of expenses) { (byDate[e.expense_date] ??= []).push(e); }
        const sortedDates = Object.keys(byDate).sort();

        const byPayer: Record<string, Expense[]> = {};
        for (const e of expenses) {
          const p = e.payer || e.nickname || "나";
          (byPayer[p] ??= []).push(e);
        }

        const settlements = computeSettlements(expenses.filter(e => e.is_shared));

        function toBase(amt: number, cur: string): number | null {
          if (cur === baseCur) return amt;
          const r = xRates[cur];
          return r != null ? amt * r : null;
        }
        function grandTotal(): number | null {
          let total = 0;
          for (const [cur, amt] of Object.entries(allExpByCur)) {
            const c = toBase(amt, cur);
            if (c === null) return null;
            total += c;
          }
          return total;
        }

        const memberNicks = members.map(m => m.nickname).filter((n): n is string => !!n);

        const VIEW_TABS = [
          { id: "all" as const,      label: "날짜" },
          { id: "category" as const, label: "카테고리" },
          { id: "person" as const,   label: "인물" },
          { id: "currency" as const, label: "통화" },
          { id: "settle" as const,   label: "정산" },
        ];

        const editInSt: React.CSSProperties = { fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", outline: "none", background: "#fff" };
        const editSeSt: React.CSSProperties = { ...editInSt };

        const renderRow = (exp: Expense, hasBorder: boolean) => {
          const isEditing = editingExpenseId === exp.id;
          const linkedEvent = Object.values(schedules).flat().find(e => e.id === exp.event_id);
          const converted = exp.currency !== baseCur ? toBase(Number(exp.amount), exp.currency) : null;
          return (
            <div key={exp.id} style={{ borderBottom: hasBorder ? "1px solid rgba(0,0,0,0.05)" : "none" }}>
              {isEditing ? (
                <div style={{ padding: "12px 16px", background: "#fafaf9" }}>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
                    <input type="number" step="0.01" autoFocus placeholder="0.00"
                      value={editExpenseForm.amount}
                      onChange={e => setEditExpenseForm(f => ({ ...f, amount: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && updateExpense()}
                      style={{ ...editInSt, width: 80, flexShrink: 0 }}
                    />
                    <input list="edit-cur-list" placeholder="통화"
                      value={editExpenseForm.currency}
                      onChange={e => setEditExpenseForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))}
                      style={{ ...editInSt, width: 64 }}
                    />
                    <datalist id="edit-cur-list">
                      {CURRENCY_OPTIONS.map(c => <option key={c.code} value={c.code} />)}
                    </datalist>
                    <select value={editExpenseForm.category} onChange={e => setEditExpenseForm(f => ({ ...f, category: e.target.value }))} style={{ ...editSeSt, flex: 1 }}>
                      {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{CATEGORY_ICON[k]} {v}</option>)}
                    </select>
                  </div>
                  <input placeholder="메모" value={editExpenseForm.memo}
                    onChange={e => setEditExpenseForm(f => ({ ...f, memo: e.target.value }))}
                    style={{ ...editInSt, width: "100%", boxSizing: "border-box" as const, display: "block", marginBottom: 8 }} />
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button onClick={() => setEditingExpenseId(null)} style={{ fontSize: 13, color: "#9ca3af", background: "none", border: "1px solid #e5e7eb", borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}>취소</button>
                    <button onClick={updateExpense} style={{ fontSize: 13, color: "#fff", background: "#1a1a1a", border: "none", borderRadius: 8, padding: "6px 16px", cursor: "pointer" }}>저장</button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: "14px 16px", display: "flex", alignItems: "flex-start", gap: 12, minHeight: 52 }}>
                  <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1.3 }}>{CATEGORY_ICON[exp.category]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontSize: 15, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {exp.memo || CATEGORY_LABEL[exp.category]}
                      </span>
                      <span style={{ fontSize: 15, fontWeight: 600, color: "#111", flexShrink: 0 }}>
                        {formatAmount(Number(exp.amount), exp.currency)}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                      {expenseView === "all" && <span style={{ fontSize: 12, color: "#9ca3af" }}>{formatDateDisplay(exp.expense_date)}</span>}
                      {exp.payer && <span style={{ fontSize: 12, color: "#9ca3af" }}>👤 {exp.payer}</span>}
                      {exp.is_shared && (
                        <span style={{ fontSize: 11, color: "#0A84FF", background: "rgba(10,132,255,0.07)", borderRadius: 20, padding: "1px 8px", border: "1px solid rgba(10,132,255,0.3)", fontWeight: 600 }}>공동</span>
                      )}
                      {linkedEvent && <span style={{ fontSize: 11, color: "#bbb" }}>→ {linkedEvent.time} {linkedEvent.title}</span>}
                    </div>
                    {converted !== null && (
                      <p style={{ fontSize: 11, color: "#b0b8c4", margin: "3px 0 0" }}>≈ {formatAmount(converted, baseCur)}</p>
                    )}
                  </div>
                  {canEdit && (
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => { setEditingExpenseId(exp.id); setEditExpenseForm({ amount: String(exp.amount), currency: exp.currency, category: exp.category, memo: exp.memo ?? "", event_id: exp.event_id ?? "", payer: exp.payer ?? "", is_shared: exp.is_shared, participants: exp.participants ?? [] }); }}
                        style={{ fontSize: 12, color: "#6b7280", background: "none", border: "1px solid #e5e7eb", borderRadius: 8, padding: "5px 10px", cursor: "pointer", minHeight: 32 }}>수정</button>
                      <button onClick={() => deleteExpense(exp.id)}
                        style={{ fontSize: 12, color: "#ef4444", background: "none", border: "1px solid #fee2e2", borderRadius: 8, padding: "5px 10px", cursor: "pointer", minHeight: 32 }}>삭제</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        };

        const renderSection = (exps: Expense[], label: React.ReactNode, totals: Record<string, number>) => {
          if (exps.length === 0) return null;
          const sorted = [...exps].sort((a, b) => a.expense_date.localeCompare(b.expense_date) || a.created_at.localeCompare(b.created_at));
          return (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 2px 8px", marginBottom: 4 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "#9ca3af", margin: 0 }}>{label}</p>
                <div style={{ display: "flex", gap: 8 }}>
                  {Object.entries(totals).map(([cur, amt]) => (
                    <span key={cur} style={{ fontSize: 13, fontWeight: 600, color: "#6b7280" }}>{formatAmount(amt, cur)}</span>
                  ))}
                </div>
              </div>
              <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                {sorted.map((exp, i) => renderRow(exp, i < sorted.length - 1))}
              </div>
            </div>
          );
        };

        return (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "#F7F7F5" }}>

            {/* ── 요약 헤더 ── */}
            <div style={{ background: "#fff", padding: "20px 20px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)", flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
                <div>
                  <p style={{ fontSize: 26, fontWeight: 700, color: "#111", margin: "0 0 2px", letterSpacing: "-0.5px" }}>경비</p>
                  <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>{expenses.length}개 항목</p>
                </div>
                <button
                  onClick={() => setShowRatePanel(p => !p)}
                  style={{ fontSize: 12, color: showRatePanel ? "#0A84FF" : "#9ca3af", background: "none", border: `1px solid ${showRatePanel ? "rgba(10,132,255,0.3)" : "#e5e7eb"}`, borderRadius: 10, padding: "8px 14px", cursor: "pointer", flexShrink: 0, fontWeight: showRatePanel ? 600 : 400 }}
                >환율 설정</button>
              </div>

              {/* 환율 패널 */}
              {showRatePanel && (
                <div style={{ background: "#f9fafb", borderRadius: 12, padding: "14px 16px", border: "1px solid #e5e7eb", marginBottom: 16 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", margin: "0 0 10px" }}>1 [통화] = ? {baseCur}  <span style={{ fontWeight: 400, color: "#9ca3af" }}>· 멤버 전체 공유</span></p>
                  {/* 사용 중인 통화의 환율 */}
                  {Object.keys(allExpByCur).filter(c => c !== baseCur).map(cur => (
                    <div key={cur} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <span style={{ fontSize: 14, color: "#374151", fontWeight: 600, width: 44, flexShrink: 0 }}>{cur}</span>
                      <input type="number" step="any" placeholder="환율"
                        value={xRates[cur] ?? ""}
                        onChange={e => {
                          const v = parseFloat(e.target.value);
                          setTripInfo(t => {
                            const next = { ...(t.exchangeRates ?? {}) };
                            if (isNaN(v) || v <= 0) delete next[cur];
                            else next[cur] = v;
                            return { ...t, exchangeRates: next };
                          });
                        }}
                        style={{ fontSize: 14, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 12px", flex: 1, outline: "none" }}
                      />
                      <span style={{ fontSize: 12, color: "#9ca3af", flexShrink: 0 }}>{baseCur}</span>
                      {xRates[cur] && (
                        <button onClick={() => setTripInfo(t => { const next = { ...(t.exchangeRates ?? {}) }; delete next[cur]; return { ...t, exchangeRates: next }; })}
                          style={{ fontSize: 16, color: "#d1d5db", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: 0, flexShrink: 0 }}>×</button>
                      )}
                    </div>
                  ))}
                  {/* 커스텀 통화 추가 */}
                  <div style={{ display: "flex", gap: 8, marginTop: 8, paddingTop: 10, borderTop: "1px dashed #e5e7eb", alignItems: "center" }}>
                    <input placeholder="코드 (SEK...)"
                      value={newRateCur}
                      onChange={e => setNewRateCur(e.target.value.toUpperCase())}
                      style={{ fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", width: 100, flexShrink: 0, outline: "none" }}
                    />
                    <input type="number" step="any" placeholder={`= ? ${baseCur}`}
                      value={newRateVal}
                      onChange={e => setNewRateVal(e.target.value)}
                      style={{ fontSize: 13, border: "1px solid #e5e7eb", borderRadius: 8, padding: "7px 10px", flex: 1, outline: "none" }}
                    />
                    <button
                      onClick={() => {
                        const v = parseFloat(newRateVal);
                        if (!newRateCur || isNaN(v) || v <= 0) return;
                        setTripInfo(t => ({ ...t, exchangeRates: { ...(t.exchangeRates ?? {}), [newRateCur]: v } }));
                        setNewRateCur(""); setNewRateVal("");
                      }}
                      style={{ fontSize: 13, color: "#fff", background: "#0A84FF", border: "none", borderRadius: 8, padding: "7px 14px", cursor: "pointer", flexShrink: 0 }}
                    >추가</button>
                  </div>
                  {/* 저장된 커스텀 환율 목록 */}
                  {Object.keys(xRates).filter(c => !allExpByCur[c] && c !== baseCur).length > 0 && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #e5e7eb" }}>
                      {Object.entries(xRates).filter(([c]) => !allExpByCur[c] && c !== baseCur).map(([cur, rate]) => (
                        <div key={cur} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                          <span style={{ fontSize: 13, color: "#9ca3af", flex: 1 }}>1 {cur} = {formatAmount(rate, baseCur)}</span>
                          <button onClick={() => setTripInfo(t => { const next = { ...(t.exchangeRates ?? {}) }; delete next[cur]; return { ...t, exchangeRates: next }; })}
                            style={{ fontSize: 16, color: "#d1d5db", background: "none", border: "none", cursor: "pointer", lineHeight: 1, padding: 0 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 통화별 합계 */}
              {expenses.length > 0 && (
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  {Object.entries(allExpByCur).sort().map(([cur, amt]) => (
                    <div key={cur}>
                      <p style={{ fontSize: 22, fontWeight: 700, color: "#111", margin: 0, letterSpacing: "-0.3px" }}>{formatAmount(amt, cur)}</p>
                      {cur !== baseCur && xRates[cur] && (
                        <p style={{ fontSize: 12, color: "#9ca3af", margin: "2px 0 0" }}>≈ {formatAmount(amt * xRates[cur], baseCur)}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 환산 합계 */}
              {expenses.length > 0 && Object.keys(allExpByCur).length > 1 && (() => {
                const gt = grandTotal();
                if (gt === null) return null;
                return <p style={{ fontSize: 13, color: "#0A84FF", margin: "10px 0 0", fontWeight: 600 }}>≈ {formatAmount(gt, baseCur)} 합산</p>;
              })()}

              {/* 공동 / 개인 */}
              {expenses.some(e => e.is_shared) && (
                <div style={{ display: "flex", gap: 20, marginTop: 14, paddingTop: 14, borderTop: "1px dashed rgba(0,0,0,0.08)" }}>
                  {Object.keys(sharedByCur).length > 0 && (
                    <div>
                      <p style={{ fontSize: 10, color: "#9ca3af", margin: "0 0 4px", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>공동</p>
                      {Object.entries(sharedByCur).map(([cur, amt]) => (
                        <p key={cur} style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", margin: 0 }}>{formatAmount(amt, cur)}</p>
                      ))}
                    </div>
                  )}
                  {Object.keys(personalByCur).length > 0 && (
                    <div>
                      <p style={{ fontSize: 10, color: "#9ca3af", margin: "0 0 4px", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>개인</p>
                      {Object.entries(personalByCur).map(([cur, amt]) => (
                        <p key={cur} style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a", margin: 0 }}>{formatAmount(amt, cur)}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── 뷰 탭 ── */}
            <div style={{ background: "#fff", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", padding: "0 4px", flexShrink: 0, overflowX: "auto", scrollbarWidth: "none" as const }}>
              {VIEW_TABS.map(({ id, label }) => (
                <button key={id} onClick={() => setExpenseView(id)}
                  style={{ padding: "11px 14px", fontSize: 13, whiteSpace: "nowrap", fontWeight: expenseView === id ? 600 : 400, color: expenseView === id ? "#1a1a1a" : "#9ca3af", background: "none", border: "none", cursor: "pointer", borderBottom: expenseView === id ? "2px solid #0A84FF" : "2px solid transparent", marginBottom: -1, transition: "color 150ms", flexShrink: 0 }}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── 목록 ── */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 16px 32px" }}>
              {expenses.length === 0 && (
                <div style={{ textAlign: "center", padding: "80px 20px", color: "#9ca3af" }}>
                  <p style={{ fontSize: 40, marginBottom: 12 }}>💰</p>
                  <p style={{ fontSize: 15, margin: 0, fontWeight: 500, color: "#6b7280" }}>경비가 없습니다</p>
                  <p style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.6 }}>여행 계획 탭에서 일별 경비를 추가하거나<br />아래 + 버튼을 눌러 직접 추가하세요</p>
                </div>
              )}

              {/* 날짜별 */}
              {expenseView === "all" && sortedDates.map(date => {
                const dayExp = byDate[date];
                const dayTotals: Record<string, number> = {};
                for (const e of dayExp) dayTotals[e.currency] = (dayTotals[e.currency] ?? 0) + Number(e.amount);
                return renderSection(dayExp, fmtBookingDate(date), dayTotals);
              })}

              {/* 카테고리별 */}
              {expenseView === "category" && Object.entries(CATEGORY_LABEL).map(([cat, label]) => {
                const catExp = expenses.filter(e => e.category === cat);
                const catTotals: Record<string, number> = {};
                for (const e of catExp) catTotals[e.currency] = (catTotals[e.currency] ?? 0) + Number(e.amount);
                return renderSection(catExp, `${CATEGORY_ICON[cat]} ${label}`, catTotals);
              })}

              {/* 인물별 */}
              {expenseView === "person" && Object.entries(byPayer).map(([payer, exps]) => {
                const payTotals: Record<string, number> = {};
                for (const e of exps) payTotals[e.currency] = (payTotals[e.currency] ?? 0) + Number(e.amount);
                return renderSection(exps, `👤 ${payer}`, payTotals);
              })}

              {/* 통화별 */}
              {expenseView === "currency" && Object.entries(allExpByCur).sort().map(([cur, total]) => {
                const curExp = expenses.filter(e => e.currency === cur);
                return renderSection(curExp, cur, { [cur]: total });
              })}

              {/* 정산 */}
              {expenseView === "settle" && (
                settlements.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "60px 20px", color: "#9ca3af" }}>
                    <p style={{ fontSize: 32, marginBottom: 10 }}>🤝</p>
                    <p style={{ fontSize: 15, margin: 0, fontWeight: 500, color: "#6b7280" }}>정산 내역이 없습니다</p>
                    <p style={{ fontSize: 13, margin: "6px 0 0", lineHeight: 1.6 }}>공동 경비를 추가하고<br />참여자를 설정하면 자동으로 계산됩니다</p>
                  </div>
                ) : (
                  <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                    {settlements.map((s, i) => (
                      <div key={i} style={{ padding: "16px 20px", borderBottom: i < settlements.length - 1 ? "1px solid rgba(0,0,0,0.05)" : "none", display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 56 }}>
                        <p style={{ fontSize: 15, color: "#1a1a1a", margin: 0 }}>
                          <span style={{ fontWeight: 600 }}>{s.from}</span>
                          <span style={{ color: "#9ca3af", margin: "0 8px" }}>→</span>
                          <span style={{ fontWeight: 600 }}>{s.to}</span>
                        </p>
                        <p style={{ fontSize: 17, fontWeight: 700, color: "#1a1a1a", margin: 0 }}>{formatAmount(s.amount, s.currency)}</p>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            {/* FAB */}
            {canEdit && (
              <button
                onClick={() => {
                  const today = new Date().toISOString().split("T")[0];
                  const prefs = (() => { try { return JSON.parse(localStorage.getItem(`expense-prefs-${currentTripId}`) ?? "{}"); } catch { return {}; } })();
                  const inRange = tripInfo.startDate && tripInfo.endDate && today >= tripInfo.startDate && today <= tripInfo.endDate;
                  setExpenseFormDate(inRange ? today : (tripInfo.startDate || today));
                  setExpenseForm({ amount: "", currency: prefs.currency ?? (tripInfo.currency ?? "KRW"), category: prefs.category ?? "other", memo: "", event_id: "", payer: prefs.payer ?? "", is_shared: false, participants: [] });
                  setShowExpenseSheet(true);
                }}
                style={{ position: "fixed", bottom: "calc(env(safe-area-inset-bottom) + 72px)", right: 20, zIndex: 100, width: 52, height: 52, borderRadius: "50%", background: "#0A84FF", color: "#fff", border: "none", fontSize: 26, cursor: "pointer", boxShadow: "0 4px 18px rgba(10,132,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
              >+</button>
            )}

          </div>
        );
      })()}

      {/* ── 경비 추가 바텀시트 (공용) ── */}
      {showExpenseSheet && typeof document !== "undefined" && createPortal(
        <div onClick={() => setShowExpenseSheet(false)} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.4)", overflow: "hidden" }}>
          <div onClick={e => e.stopPropagation()} style={{ position: "fixed", bottom: 0, left: 0, right: 0, width: "100%", maxWidth: "100vw", boxSizing: "border-box" as const, background: "#fff", borderRadius: "20px 20px 0 0", maxHeight: "92dvh", overflowX: "hidden", overflowY: "auto", touchAction: "pan-y", paddingBottom: "env(safe-area-inset-bottom)" }}>
            {/* Handle */}
            <div style={{ padding: "12px 0 4px", display: "flex", justifyContent: "center" }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: "#E5E5EA" }} />
            </div>
            {/* Header */}
            <div style={{ padding: "8px 20px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button onClick={() => setShowExpenseSheet(false)} style={{ fontSize: 15, color: "#0A84FF", background: "none", border: "none", cursor: "pointer", padding: 0 }}>취소</button>
              <p style={{ fontSize: 16, fontWeight: 600, color: "#111", margin: 0 }}>경비 추가</p>
              <button
                onClick={async () => {
                  if (!expenseForm.amount || !expenseFormDate) return;
                  await addExpense(expenseFormDate);
                  setShowExpenseSheet(false);
                }}
                style={{ fontSize: 15, fontWeight: 600, color: expenseForm.amount && expenseFormDate ? "#0A84FF" : "#C7C7CC", background: "none", border: "none", cursor: expenseForm.amount && expenseFormDate ? "pointer" : "default", padding: 0 }}
              >저장</button>
            </div>
            {/* Form */}
            {(() => {
              const _nicks = members.map(m => m.nickname).filter((n): n is string => !!n);
              const _evs = schedules[expenseFormDate] || [];
              return (
                <div style={{ padding: "0 20px 40px", display: "flex", flexDirection: "column", gap: 16, overflow: "hidden", boxSizing: "border-box" as const }}>
                  {/* 날짜 */}
                  <div>
                    <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 6px", fontWeight: 500 }}>날짜</p>
                    <input type="date" value={expenseFormDate} onChange={e => setExpenseFormDate(e.target.value)}
                      style={{ fontSize: 16, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "11px 14px", width: "100%", boxSizing: "border-box" as const, outline: "none", background: "#F7F7F5", caretColor: "#0A84FF" }} />
                  </div>
                  {/* 금액 + 통화 */}
                  <div>
                    <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 6px", fontWeight: 500 }}>금액 <span style={{ color: "#FF453A" }}>*</span></p>
                    <div style={{ display: "flex", gap: 8, overflow: "hidden" }}>
                      <input type="number" step="0.01" autoFocus placeholder="0.00" value={expenseForm.amount}
                        onChange={e => setExpenseForm(f => ({ ...f, amount: e.target.value }))}
                        style={{ fontSize: 16, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "11px 14px", flex: 1, minWidth: 0, outline: "none", background: "#F7F7F5", caretColor: "#0A84FF" }} />
                      <input list="exp-cur-list" placeholder="통화" value={expenseForm.currency}
                        onChange={e => setExpenseForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))}
                        style={{ fontSize: 16, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "11px 10px", width: 76, flexShrink: 0, outline: "none", textAlign: "center" as const, background: "#F7F7F5" }} />
                      <datalist id="exp-cur-list">{CURRENCY_OPTIONS.map(c => <option key={c.code} value={c.code} />)}</datalist>
                    </div>
                  </div>
                  {/* 카테고리 */}
                  <div>
                    <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 8px", fontWeight: 500 }}>카테고리</p>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, overflow: "hidden" }}>
                      {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                        <button key={k} onClick={() => setExpenseForm(f => ({ ...f, category: k }))}
                          style={{ padding: "12px 4px", borderRadius: 12, border: `2px solid ${expenseForm.category === k ? "#0A84FF" : "rgba(0,0,0,0.08)"}`, background: expenseForm.category === k ? "rgba(10,132,255,0.07)" : "#fff", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "all 150ms", minWidth: 0, overflow: "hidden" }}>
                          <span style={{ fontSize: 22 }}>{CATEGORY_ICON[k]}</span>
                          <span style={{ fontSize: 11, color: expenseForm.category === k ? "#0A84FF" : "#9ca3af", fontWeight: expenseForm.category === k ? 600 : 400, whiteSpace: "nowrap" }}>{v}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 메모 */}
                  <div>
                    <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 6px", fontWeight: 500 }}>메모 <span style={{ fontSize: 11, color: "#C7C7CC" }}>(선택)</span></p>
                    <input placeholder="예: 점심 식사" value={expenseForm.memo}
                      onChange={e => setExpenseForm(f => ({ ...f, memo: e.target.value }))}
                      style={{ fontSize: 16, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "11px 14px", width: "100%", boxSizing: "border-box" as const, outline: "none", background: "#F7F7F5", caretColor: "#0A84FF" }} />
                  </div>
                  {/* 지불자 */}
                  <div>
                    <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 6px", fontWeight: 500 }}>지불자 <span style={{ fontSize: 11, color: "#C7C7CC" }}>(선택)</span></p>
                    {_nicks.length > 0 ? (
                      <select value={expenseForm.payer} onChange={e => setExpenseForm(f => ({ ...f, payer: e.target.value }))}
                        style={{ fontSize: 16, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "11px 14px", width: "100%", boxSizing: "border-box" as const, outline: "none", background: "#F7F7F5" }}>
                        <option value="">선택 안 함</option>
                        {_nicks.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    ) : (
                      <input placeholder="이름" value={expenseForm.payer}
                        onChange={e => setExpenseForm(f => ({ ...f, payer: e.target.value }))}
                        style={{ fontSize: 16, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "11px 14px", width: "100%", boxSizing: "border-box" as const, outline: "none", background: "#F7F7F5", caretColor: "#0A84FF" }} />
                    )}
                  </div>
                  {/* 일정 연결 (선택 날짜에 일정이 있을 때) */}
                  {_evs.length > 0 && (
                    <div>
                      <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 6px", fontWeight: 500 }}>일정 연결 <span style={{ fontSize: 11, color: "#C7C7CC" }}>(선택)</span></p>
                      <select value={expenseForm.event_id} onChange={e => setExpenseForm(f => ({ ...f, event_id: e.target.value }))}
                        style={{ fontSize: 16, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, padding: "11px 14px", width: "100%", boxSizing: "border-box" as const, outline: "none", background: "#F7F7F5", appearance: "none" as const }}>
                        <option value="">연결 안 함</option>
                        {_evs.map(ev => <option key={ev.id} value={ev.id}>{ev.time} {ev.title}</option>)}
                      </select>
                    </div>
                  )}
                  {/* 공동 경비 */}
                  <div onClick={() => setExpenseForm(f => ({ ...f, is_shared: !f.is_shared, participants: [] }))}
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "14px 16px", background: "#F7F7F5", borderRadius: 14, border: "1px solid rgba(0,0,0,0.08)", cursor: "pointer", userSelect: "none" as const, overflow: "hidden" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <p style={{ fontSize: 15, fontWeight: 500, color: "#111", margin: 0 }}>공동 경비</p>
                      <p style={{ fontSize: 12, color: "#8E8E93", margin: "2px 0 0" }}>정산 계산에 포함됩니다</p>
                    </div>
                    <div style={{ width: 50, height: 30, borderRadius: 15, background: expenseForm.is_shared ? "#0A84FF" : "#d1d5db", position: "relative", transition: "background 200ms", flexShrink: 0 }}>
                      <div style={{ position: "absolute", top: 4, left: expenseForm.is_shared ? 24 : 4, width: 22, height: 22, borderRadius: "50%", background: "#fff", transition: "left 200ms", boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
                    </div>
                  </div>
                  {/* 참여자 */}
                  {expenseForm.is_shared && _nicks.length > 0 && (
                    <div style={{ overflow: "hidden" }}>
                      <p style={{ fontSize: 12, color: "#8E8E93", margin: "0 0 10px", fontWeight: 500 }}>참여자 <span style={{ fontSize: 11, color: "#C7C7CC" }}>(선택)</span></p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, overflow: "hidden" }}>
                        {_nicks.map(n => {
                          const sel = expenseForm.participants.includes(n);
                          return (
                            <button key={n}
                              onClick={() => setExpenseForm(f => ({ ...f, participants: sel ? f.participants.filter(p => p !== n) : [...f.participants, n] }))}
                              style={{ padding: "8px 16px", borderRadius: 20, border: `1.5px solid ${sel ? "#0A84FF" : "rgba(0,0,0,0.1)"}`, background: sel ? "rgba(10,132,255,0.07)" : "#fff", color: sel ? "#0A84FF" : "#6b7280", fontSize: 14, cursor: "pointer", fontWeight: sel ? 600 : 400, transition: "all 150ms", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {n}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* 저장 */}
                  <button
                    onClick={async () => {
                      if (!expenseForm.amount || !expenseFormDate) return;
                      await addExpense(expenseFormDate);
                      setShowExpenseSheet(false);
                    }}
                    disabled={!expenseForm.amount || !expenseFormDate}
                    style={{ width: "100%", padding: "16px", fontSize: 16, fontWeight: 700, color: "#fff", background: expenseForm.amount && expenseFormDate ? "#0A84FF" : "#d1d5db", border: "none", borderRadius: 14, cursor: expenseForm.amount && expenseFormDate ? "pointer" : "default", marginTop: 4 }}
                  >저장하기</button>
                </div>
              );
            })()}
          </div>
        </div>,
        document.body
      )}

      {/* ── Bottom Tab Bar ── */}
      <nav style={{
        flexShrink: 0,
        background: "rgba(255,255,255,0.96)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderTop: "1px solid rgba(0,0,0,0.08)",
        display: "flex",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        {([
          { id: "plan",      label: "계획" },
          { id: "bookings",  label: "예약" },
          { id: "checklist", label: "준비물" },
          { id: "expenses",  label: "경비" },
        ] as const).map(({ id, label }) => {
          const isActive = plannerTab === id;
          return (
            <button
              key={id}
              onClick={() => setPlannerTab(id)}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                background: "none", border: "none", cursor: "pointer",
                minHeight: 56,
                color: isActive ? "#0A84FF" : "#8E8E93",
                fontSize: 13, fontWeight: isActive ? 600 : 400,
                transition: "color 150ms",
                WebkitTapHighlightColor: "transparent",
              }}
            >{label}</button>
          );
        })}
      </nav>

      {/* 라이트박스 — 모든 탭에서 공유 */}
      {lightboxUrl && typeof document !== "undefined" && createPortal(
        <div onClick={() => setLightboxUrl(null)}
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.93)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxUrl} alt="" style={{ maxWidth: "95vw", maxHeight: "90dvh", objectFit: "contain", borderRadius: 8 }} onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightboxUrl(null)} style={{ position: "fixed", top: 20, right: 20, width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 22, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>,
        document.body
      )}

      {/* Leave trip confirmation modal */}
      {showRouteMap && (
        <RouteMapModal events={selEvents} onClose={() => setShowRouteMap(false)} />
      )}

      {showLeaveModal && (
        <div
          onClick={() => setShowLeaveModal(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            background: "rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "16px",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 14,
              boxShadow: "0 8px 40px rgba(0,0,0,0.14)",
              padding: "28px 28px 22px",
              width: "100%", maxWidth: 340,
            }}
          >
            <p style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a", margin: "0 0 10px" }}>여행 나가기</p>
            <p style={{ fontSize: 13, color: "#666", margin: "0 0 24px", lineHeight: 1.55 }}>이 여행에서 나가시겠습니까?</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowLeaveModal(false)}
                style={{ fontSize: 13, color: "#666", background: "none", border: "1px solid #ddd", borderRadius: 8, padding: "8px 18px", cursor: "pointer" }}
              >취소</button>
              <button
                onClick={async () => { await leaveTrip(); setShowLeaveModal(false); }}
                style={{ fontSize: 13, fontWeight: 500, color: "#fff", background: "#1a1a1a", border: "none", borderRadius: 8, padding: "8px 18px", cursor: "pointer" }}
              >나가기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
