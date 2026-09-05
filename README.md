# Ladder Studio

Środowisko do programowania sterowników PLC w przeglądarce: edytor drabinkowy (LD),
schemat blokowy (FBD), Structured Text (ST), symulacja w czasie rzeczywistym,
panel operatorski HMI i eksport do formatów standardowych.

Jedna aplikacja działa na komputerze i na telefonie — interfejs jest responsywny,
obsługuje dotyk i instaluje się jako aplikacja (PWA).

## Wersja online

Aplikacja publikuje się automatycznie na GitHub Pages przy każdym pushu:

**https://biznesmen6996-collab.github.io/Ladder/**

Workflow (`.github/workflows/deploy.yml`) najpierw sprawdza typy i uruchamia testy,
a dopiero potem buduje i wdraża — nieudany test zatrzymuje publikację.

> **Jednorazowe ustawienie, którego nie da się zrobić z poziomu workflow:**
> Settings → Pages → *Source* → **GitHub Actions**.
> Domyślny token GitHub Actions nie ma uprawnień do utworzenia witryny Pages, więc
> musi to zrobić właściciel repozytorium. Po przestawieniu tego przełącznika
> wystarczy w zakładce Actions ponownie uruchomić workflow (*Re-run all jobs*) —
> kolejne pushe publikują się już automatycznie.

Pod tym adresem wchodzisz z telefonu i instalujesz aplikację na ekranie głównym —
dalej działa już bez internetu.

## Uruchomienie lokalne

```bash
npm install
npm run dev        # serwer deweloperski
npm run build      # wersja produkcyjna do katalogu dist/
npm run preview    # podgląd wersji produkcyjnej
npm test           # testy silnika (32 testy)
npm run typecheck  # kontrola typów
```

## Co potrafi

### Edytor drabinki (LD)
- styki zwierne, rozwierne oraz wykrywające zbocze narastające i opadające
- cewki: zwykła, zanegowana, ustawiająca (S), zerująca (R), impulsowe (P/N)
- styki porównania `A > B` z dowolnym wyrażeniem po obu stronach
- gałęzie równoległe z łącznikami pionowymi, wstawianie i usuwanie kolumn
- bloki funkcyjne osadzane w szczeblu, z podpinaniem zmiennych do pinów
- **podgląd przepływu prądu na żywo** — zasilone odcinki szyny świecą podczas symulacji
- komentarz do każdego szczebla, wyłączanie szczebli, pułapki dla debugera
- obsługa dotyku: przytrzymanie palcem otwiera menu kontekstowe

### Edytor blokowy (FBD)
Bloki rozmieszczane na siatce, połączenia rysowane przeciąganiem od pinu do pinu,
negacja wejść, stałe wpisywane wprost na piny, animacja stanu połączeń w trakcie symulacji.

### Structured Text i konwersja w obie strony
Pełny podzbiór IEC 61131-3: `IF/ELSIF/ELSE`, `CASE`, `FOR`, `WHILE`, `REPEAT`,
wywołania bloków funkcyjnych, wyrażenia arytmetyczne i logiczne, literały czasu `T#1m30s`.

- **drabinka → ST** — generator produkuje czytelny kod z komentarzami szczebli
- **ST → drabinka** — parser buduje sieć szeregowo-równoległą i rozkłada ją na siatkę
- edytor kodu z podświetlaniem składni i bieżącą kontrolą poprawności

Testy sprawdzają, że układ po konwersji w obie strony zachowuje się identycznie.

### Symulacja
Wirtualny sterownik wykonuje program w cyklu skanowania z wirtualnym czasem,
więc wynik nie zależy od wydajności przeglądarki.

- start / stop, **krok pojedynczego szczebla**, krok całego cyklu, reset
- regulacja prędkości od 0,1× do 10× oraz tryb maksymalny
- pułapki na szczeblach zatrzymujące wykonanie
- wymuszanie wartości zmiennych (forcing) niezależnie od programu
- tablica obserwacji, wykresy przebiegów, historia alarmów, statystyki czasu cyklu
- generatory sygnałów na wejściach: przełączanie, impuls, narastanie, sinusoida, szum

### Panel operatorski HMI
Projektowanie metodą przeciągnij-i-upuść, 28 komponentów przemysłowych podpinanych
do zmiennych programu:

| Grupa | Komponenty |
|---|---|
| Podstawowe | etykieta, ramka grupująca, symbol |
| Sterowanie | przycisk chwilowy, przełącznik, przełącznik pozycyjny, suwak, pole wprowadzania |
| Sygnalizacja | lampka, kolumna sygnalizacyjna, sygnalizator drogowy, linijka LED, wyświetlacz 7-segmentowy |
| Pomiary | odczyt wartości, wskaźnik zegarowy, słupek, wykres przebiegu, lista alarmów |
| Technologia | zbiornik, silos, silnik, pompa, zawór, siłownik, przenośnik, rurociąg, grzałka, czujnik |

Panel można uruchomić w trybie pracy — komponenty reagują na dotyk i sterują programem.

### Biblioteka i katalog aparatury
- własne bloki funkcyjne (FB) i funkcje (FUN) w dowolnym z trzech języków
- biblioteka projektu z eksportem i importem przez plik JSON
- katalog ~40 aparatów przemysłowych (czujniki, napędy, falowniki, zawory, zabezpieczenia,
  aparatura sterownicza, urządzenia procesowe) — wybór aparatu tworzy komplet opisanych zmiennych

### Szablony przemysłowe
Gotowe, działające projekty z drabinką, ekranem HMI i alarmami:
rozruch START/STOP, gwiazda-trójkąt, napełnianie zbiornika, regulacja temperatury PID,
sygnalizacja świetlna, przenośnik z sortowaniem, przepompownia z pracą naprzemienną,
mieszalnik wsadowy, brama automatyczna.

### Eksport i import
| Format | Zastosowanie |
|---|---|
| PLCopen XML | wymiana projektu ze środowiskami producentów sterowników (drabinka jako graf połączeń) |
| Structured Text | kod źródłowy całego projektu z deklaracjami i konfiguracją zadań |
| Lista instrukcji (IL) | klasyczny format tekstowy sterowników |
| JSON | pełny zapis projektu z HMI, alarmami i I/O — wczytywany bez strat |
| CSV | lista tagów do systemów SCADA |
| Markdown | dokumentacja programu szczebel po szczeblu |

Import działa dla JSON, PLCopen XML oraz plików `.st` — kod ST jest automatycznie
zamieniany na drabinkę.

### Obsługa wielu monitorów
Każdy widok (panel HMI, drabinka, kod, zmienne) można otworzyć w osobnym oknie
i przenieść na drugi monitor. Okna synchronizują się przez `BroadcastChannel`:
symulacja pracuje w oknie głównym, pozostałe pokazują jej stan na żywo i mogą
wysyłać polecenia oraz sterować zmiennymi.

### Tryb ciemny i jasny
Motyw przełączany ikoną w pasku górnym, z opcją podążania za ustawieniem systemu.

## Jak to działa na telefonie i na komputerze

Aplikacja jest napisana raz, jako **PWA** (Progressive Web App) — to najprostsza i
najtańsza w utrzymaniu droga do obu platform:

- **PC / laptop** — otwierasz w przeglądarce albo instalujesz ikoną w pasku adresu;
  aplikacja dostaje własne okno bez paska przeglądarki
- **Android** — menu przeglądarki → „Dodaj do ekranu głównego”
- **iPhone / iPad** — Udostępnij → „Dodaj do ekranu początkowego”
- po instalacji projekt działa **bez internetu** (service worker cache'uje całą aplikację),
  a bieżący projekt zapisuje się w pamięci przeglądarki

Interfejs dostosowuje się do ekranu: na telefonie panele boczne stają się szufladami,
pojawia się dolna nawigacja, elementy drabinki są większe, a paski narzędzi zwijają się
do najważniejszych przycisków. Wszystkie interakcje obsługują dotyk (przeciąganie
komponentów HMI, rysowanie połączeń FBD, przytrzymanie zamiast prawego przycisku myszy).

Jeśli w przyszłości potrzebna byłaby obecność w sklepach z aplikacjami albo dostęp do
sprzętu (port szeregowy, sieć przemysłowa), ten sam kod można opakować bez przepisywania:
**Capacitor** dla Androida i iOS, **Tauri** lub **Electron** dla wersji desktopowej.

## Architektura

```
src/
  core/                 silnik — niezależny od interfejsu, w pełni testowalny
    types.ts            model projektu (POU, szczeble, zmienne, HMI, alarmy)
    blocks.ts           biblioteka bloków funkcyjnych wraz z implementacją runtime
    grid.ts             operacje na siatce drabinki
    evaluate.ts         wykonanie szczebla ze śledzeniem przepływu prądu
    fbd.ts              wykonanie sieci blokowej
    simulator.ts        cykl skanowania, instancje bloków, alarmy, trendy
    expr.ts             obliczanie wyrażeń z pamięcią podręczną
    exporters.ts        PLCopen XML, IL, ST, JSON, CSV, Markdown
    importers.ts        odtwarzanie projektu z XML / ST / JSON
    xml.ts              minimalny parser i generator XML (bez zależności)
    st/                 język Structured Text
      lexer.ts parser.ts ast.ts interp.ts codegen.ts toladder.ts print.ts
  state/                stan aplikacji (zustand), pętla symulacji, magistrala okien
  ui/                   komponenty interfejsu
  hmi/widgets.tsx       biblioteka komponentów panelu operatorskiego
  data/                 szablony projektów i katalog aparatury
tests/                  testy silnika uruchamiane przez node:test
```

Zależności produkcyjne: React i zustand. Reszta — parser ST, generator XML, symulator,
grafika drabinki i komponenty HMI — jest napisana od zera, bez bibliotek zewnętrznych.

## Skróty klawiszowe

| Skrót | Działanie |
|---|---|
| `Ctrl+Z` / `Ctrl+Y` | cofnij / ponów |
| `Ctrl+S` | zapisz projekt do pliku |
| `F5` | start / stop symulacji |
| `F10` | krok jednego szczebla |
| `F11` | jeden pełny cykl |

## Uwaga

Ladder Studio jest środowiskiem do nauki, projektowania i testowania logiki sterowania.
Symulator odwzorowuje zachowanie sterownika zgodnie z IEC 61131-3, ale przed wgraniem
programu na rzeczywistą maszynę zawsze zweryfikuj go w środowisku producenta sterownika
i wykonaj analizę bezpieczeństwa.
