# DESIGN.md

## Product Vision

이 프로젝트는 여행 계획을 세우는 웹사이트가 아니라 실제 여행 중 매일 사용하는 모바일 앱을 목표로 한다.

사용자는 여행 전 계획을 세우고,
여행 중 예약을 확인하고,
비용을 기록하고,
준비물을 체크하며,
여행 후에는 정산과 기록을 확인한다.

모든 디자인 결정은 "실제 여행 중 한 손으로 사용하기 편한가?"를 기준으로 판단한다.

---

# Design Principles

## 1. Mobile First

데스크탑보다 모바일을 우선한다.

기능 추가 시 항상 iPhone Safari 기준으로 먼저 고려한다.

목표:

- 한 손 사용 가능
- 큰 터치 영역
- 입력 시 확대 없음
- 이동 중 빠른 확인 가능

---

## 2. Apple + Notion

참고 서비스

- Apple Messages
- Apple Maps
- Apple Notes
- Notion
- Tripsy

지향하는 분위기

- 조용함
- 정돈됨
- 여백
- 가독성
- 과하지 않은 아름다움

---

## 3. Function First

장식보다 사용성을 우선한다.

추가 금지:

- 과도한 그라데이션
- 네온 컬러
- 복잡한 차트
- 개발자 대시보드 스타일
- 지나친 애니메이션

---

# Color System

## Background

#F7F7F5

밝고 중립적인 배경. 흰색보다 살짝 따뜻한 톤.

---

## Card

#FFFFFF

---

## Primary Text

#111111

---

## Secondary Text

#6B7280

---

## Accent — Apple Blue

#0A84FF

원칙: **절제된 사용**. 전체 화면이 파랗게 보여서는 안 된다.

Apple Messages, Apple Notes, Apple Maps 수준의 사용량 유지.

사용 위치 (강조 요소에만):

- 활성 탭 인디케이터
- 주요 액션 버튼 (저장, 추가, 참여)
- 선택 상태 (캘린더 선택 날짜, 필터 선택)
- 링크
- Toggle 활성 상태
- FAB 버튼

사용 금지:

- 배경을 파랗게 채우는 용도
- 단순 정보 표시 레이블
- 아이콘 전체 색상

---

## Success / Complete

#34C759

사용 위치:

- 완료된 일정의 체크마크
- 체크리스트 체크 상태
- 진행률 표시줄

---

## Warning

#FF9F0A

---

## Error

#FF453A

---

## Accent Light Background

rgba(10, 132, 255, 0.08)

선택 상태 배경에만 사용. 예: 선택된 카테고리 버튼.

---

# Typography

## Font Priority

- SF Pro (iOS/macOS)
- Inter
- System Sans

---

## Heading

크고 단순하게.

예시:

GLP Europe
경비

---

## Body

- 기본: 15px
- 보조: 13px
- 레이블: 12px

---

## Avoid

- 지나치게 굵은 텍스트 남발
- 색상으로만 정보 전달
- ALL CAPS

---

# Layout

## Section Spacing

넓은 여백 사용.

답답하게 붙이지 않는다.

- 카드 내부 패딩: 16–20px
- 카드 사이 간격: 12px
- 화면 좌우 여백: 16px (mobile)

---

## Cards

기본 UI는 카드 기반.

카드는:

- 흰색 배경 (#FFFFFF)
- 얇은 그림자: `0 1px 8px rgba(0,0,0,0.06)`
- 큰 Radius: `border-radius: 16px`
- 테두리: `1px solid rgba(0,0,0,0.06)` (선택적)

상단 포인트 라인 (borderTop 강조) 사용 금지.

---

# Navigation

## Bottom Tab Bar

최종 구조 (4개 탭):

📅 계획
🎫 예약
☑️ 준비물
💰 경비

향후 필요 시:

📔 다이어리 (현재는 헤더 버튼으로 접근)

---

탭은 항상 하단 고정.

- `position: fixed; bottom: 0`
- iOS Safe Area 대응: `padding-bottom: env(safe-area-inset-bottom)`
- 탭 높이: 56px + safe area
- 아이콘 + 레이블, 터치 영역 44px 이상

여행 중 가장 많이 사용하는 기능에 즉시 접근 가능해야 한다.

---

# Planner

일정은 가장 자주 사용하는 화면이다.

## 모바일 레이아웃 우선순위

1. 캘린더 (날짜 선택)
2. 일정 목록 (메인 컨텐츠)
3. 여행 정보 / 멤버 (아코디언 — 접힘/펼침)
4. 여정 요약 (아코디언)

---

## 일정 추가

Bottom Sheet 방식. Apple Calendar 스타일.

"+ 일정 추가" 버튼 → Bottom Sheet:

- 제목 (큰 입력, 16px+)
- 시간
- 카테고리 (칩 선택)
- 장소 (Google Maps PlaceSearch)
- 예약 연결

---

# Booking

예약 화면은 실제 여행 중 확인용이다.

예약번호 입력 중심이 아니다.

우선순위:

1. 링크
2. PDF
3. 이미지
4. 메모

예약번호는 선택 사항.

---

카테고리:

✈️ 항공
🏨 숙소
🚆 교통
🎟 티켓

---

일정과 연결 가능해야 한다.

---

# Checklist

체크리스트는 준비물 앱처럼 동작한다.

중요 요소:

- 빠른 체크
- 진행률 표시
- 큰 터치 영역 (44px+)

행 전체를 눌러 체크 가능해야 한다.

---

# Expenses

경비는 여행 후 정산용이 아니라
여행 중 확인용이다.

우선순위:

1. 현재 총 지출
2. 공동 경비
3. 개인 경비
4. 카테고리 분석

---

복잡한 회계 UI 금지.

---

# Interaction

## Touch Area

최소 44px

---

## Inputs

font-size: 16px 이상

iOS Safari 확대 금지

---

## Modal

가능하면 Full Screen 대신 Bottom Sheet 사용

Bottom Sheet 스펙:

- handle bar (36px wide, 4px tall, rounded)
- border-radius: 20px 20px 0 0
- max-height: 92dvh
- overlay: rgba(0,0,0,0.4)

---

## Animations

짧고 자연스럽게.

150–250ms.

ease-out 사용.

---

# What We Are NOT

이 앱은

- ERP
- 프로젝트 관리 툴
- 회계 프로그램
- 데이터 대시보드

가 아니다.

---

# Final Goal

사용자가 여행 중

"항공권 어디 있었지?"

"호텔 예약 링크 뭐였지?"

"우리 공동 경비 얼마 썼지?"

를 3초 안에 확인할 수 있는 앱을 만든다

---

# UI Refactor Sprint Status

## Phase 1 — 디자인 토큰 (완료)

- [x] DESIGN.md 업데이트
- [x] Accent #4e9e8a → #0A84FF
- [x] Complete/Check state → #34C759
- [x] 배경색 통일 #F7F7F5

## Phase 2 — Bottom Tab Bar (예정)

## Phase 3 — 일정 추가 Bottom Sheet (예정)

## Phase 4 — 모바일 레이아웃 개편 (예정)

## Phase 5 — 카드 디자인 통일 + 여백 (예정)
