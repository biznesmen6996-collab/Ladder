import type { DataType } from '../core/types'

/** Katalog aparatury przemysłowej — wstawienie tworzy komplet opisanych zmiennych. */
export interface ComponentSignal {
  name: string
  type: DataType
  comment: string
}

export interface ComponentDef {
  id: string
  name: string
  category: string
  glyph: string
  /** przedrostek nazw zmiennych, np. B dla czujników */
  prefix: string
  description: string
  signals: ComponentSignal[]
}

const s = (name: string, type: DataType, comment: string): ComponentSignal => ({ name, type, comment })

export const COMPONENTS: ComponentDef[] = [
  /* ------------------------------ czujniki ------------------------- */
  {
    id: 'prox', name: 'Czujnik zbliżeniowy indukcyjny', category: 'Czujniki', glyph: '🧲', prefix: 'B',
    description: 'Bezstykowe wykrywanie elementów metalowych, typowe wyjście PNP 24 V DC.',
    signals: [s('Sygnal', 'BOOL', 'obecność elementu')],
  },
  {
    id: 'photo', name: 'Fotokomórka', category: 'Czujniki', glyph: '💡', prefix: 'B',
    description: 'Bariera optyczna do zliczania i wykrywania detali na przenośniku.',
    signals: [s('Sygnal', 'BOOL', 'przerwanie wiązki')],
  },
  {
    id: 'limit', name: 'Wyłącznik krańcowy', category: 'Czujniki', glyph: '🔘', prefix: 'S',
    description: 'Styk mechaniczny sygnalizujący osiągnięcie położenia krańcowego.',
    signals: [s('Sygnal', 'BOOL', 'położenie osiągnięte')],
  },
  {
    id: 'encoder', name: 'Enkoder inkrementalny', category: 'Czujniki', glyph: '🔄', prefix: 'B',
    description: 'Pomiar położenia i prędkości obrotowej wału.',
    signals: [
      s('Impulsy', 'DINT', 'licznik impulsów'),
      s('Predkosc', 'REAL', 'prędkość obrotowa [obr/min]'),
      s('Zerowanie', 'BOOL', 'kasowanie licznika'),
    ],
  },
  {
    id: 'level-float', name: 'Pływakowy czujnik poziomu', category: 'Czujniki', glyph: '🎈', prefix: 'L',
    description: 'Dwustanowa sygnalizacja poziomu cieczy w zbiorniku.',
    signals: [s('PoziomMin', 'BOOL', 'poziom minimalny'), s('PoziomMax', 'BOOL', 'poziom maksymalny')],
  },
  {
    id: 'safety-curtain', name: 'Kurtyna bezpieczeństwa', category: 'Czujniki', glyph: '🚧', prefix: 'K',
    description: 'Optoelektroniczne urządzenie ochronne ze stykami OSSD.',
    signals: [s('OSSD1', 'BOOL', 'kanał 1 — strefa wolna'), s('OSSD2', 'BOOL', 'kanał 2 — strefa wolna')],
  },

  /* ------------------------------ pomiary -------------------------- */
  {
    id: 'temp-pt100', name: 'Czujnik temperatury Pt100', category: 'Pomiary', glyph: '🌡️', prefix: 'T',
    description: 'Rezystancyjny pomiar temperatury; wejście analogowe wymaga przeskalowania.',
    signals: [
      s('Surowa', 'INT', 'wartość surowa z przetwornika'),
      s('Temperatura', 'REAL', 'temperatura [°C]'),
      s('Uszkodzenie', 'BOOL', 'przerwa lub zwarcie czujnika'),
    ],
  },
  {
    id: 'pressure', name: 'Przetwornik ciśnienia', category: 'Pomiary', glyph: '📊', prefix: 'P',
    description: 'Wyjście 4–20 mA, pomiar ciśnienia w instalacji.',
    signals: [s('Surowa', 'INT', 'wartość surowa 0–27648'), s('Cisnienie', 'REAL', 'ciśnienie [bar]')],
  },
  {
    id: 'flow', name: 'Przepływomierz', category: 'Pomiary', glyph: '🌊', prefix: 'F',
    description: 'Pomiar przepływu chwilowego z możliwością sumowania.',
    signals: [s('Przeplyw', 'REAL', 'przepływ [m³/h]'), s('Suma', 'REAL', 'objętość sumaryczna [m³]')],
  },
  {
    id: 'level-analog', name: 'Sonda poziomu (analogowa)', category: 'Pomiary', glyph: '📏', prefix: 'L',
    description: 'Ciągły pomiar poziomu, np. hydrostatyczny lub ultradźwiękowy.',
    signals: [s('Surowa', 'INT', 'wartość surowa'), s('Poziom', 'REAL', 'poziom [%]')],
  },
  {
    id: 'weight', name: 'Waga tensometryczna', category: 'Pomiary', glyph: '⚖️', prefix: 'W',
    description: 'Pomiar masy wsadu z funkcją tarowania.',
    signals: [s('Masa', 'REAL', 'masa [kg]'), s('Tarowanie', 'BOOL', 'wyzerowanie wskazania'), s('Stabilna', 'BOOL', 'wskazanie ustabilizowane')],
  },
  {
    id: 'power-meter', name: 'Analizator sieci', category: 'Pomiary', glyph: '⚡', prefix: 'Q',
    description: 'Pomiar parametrów elektrycznych odbiornika.',
    signals: [s('Prad', 'REAL', 'prąd [A]'), s('Napiecie', 'REAL', 'napięcie [V]'), s('Moc', 'REAL', 'moc czynna [kW]'), s('Energia', 'REAL', 'energia [kWh]')],
  },

  /* ------------------------------ napędy --------------------------- */
  {
    id: 'motor-dol', name: 'Silnik z rozruchem bezpośrednim', category: 'Napędy', glyph: '⚙️', prefix: 'M',
    description: 'Napęd załączany stycznikiem, z zabezpieczeniem termicznym i potwierdzeniem pracy.',
    signals: [
      s('Zalacz', 'BOOL', 'sterowanie stycznikiem'),
      s('Potwierdzenie', 'BOOL', 'styk pomocniczy stycznika'),
      s('Termik', 'BOOL', 'zabezpieczenie termiczne OK'),
      s('CzasPracy', 'REAL', 'motogodziny [h]'),
    ],
  },
  {
    id: 'motor-rev', name: 'Silnik nawrotny', category: 'Napędy', glyph: '↔️', prefix: 'M',
    description: 'Napęd dwukierunkowy z blokadą wzajemną styczników.',
    signals: [
      s('WPrawo', 'BOOL', 'kierunek w prawo'),
      s('WLewo', 'BOOL', 'kierunek w lewo'),
      s('Termik', 'BOOL', 'zabezpieczenie termiczne OK'),
    ],
  },
  {
    id: 'vfd', name: 'Falownik (przemiennik częstotliwości)', category: 'Napędy', glyph: '🎛️', prefix: 'U',
    description: 'Regulacja prędkości napędu z zadawaniem częstotliwości i odczytem stanu.',
    signals: [
      s('Start', 'BOOL', 'zezwolenie na pracę'),
      s('Kierunek', 'BOOL', 'kierunek obrotów'),
      s('Zadana', 'REAL', 'prędkość zadana [%]'),
      s('Aktualna', 'REAL', 'prędkość rzeczywista [%]'),
      s('Gotowy', 'BOOL', 'falownik gotowy'),
      s('Awaria', 'BOOL', 'zgłoszona usterka'),
    ],
  },
  {
    id: 'servo', name: 'Napęd serwo', category: 'Napędy', glyph: '🎯', prefix: 'A',
    description: 'Pozycjonowanie osi z potwierdzeniem osiągnięcia pozycji.',
    signals: [
      s('Zezwolenie', 'BOOL', 'załączenie napędu'),
      s('PozycjaZadana', 'REAL', 'pozycja zadana [mm]'),
      s('PozycjaAkt', 'REAL', 'pozycja rzeczywista [mm]'),
      s('WPozycji', 'BOOL', 'pozycja osiągnięta'),
      s('Bazowanie', 'BOOL', 'żądanie bazowania'),
    ],
  },
  {
    id: 'pump', name: 'Pompa', category: 'Napędy', glyph: '💧', prefix: 'P',
    description: 'Pompa z kontrolą suchobiegu i licznikiem czasu pracy.',
    signals: [
      s('Zalacz', 'BOOL', 'załączenie pompy'),
      s('Praca', 'BOOL', 'potwierdzenie pracy'),
      s('Suchobieg', 'BOOL', 'brak medium'),
      s('CzasPracy', 'REAL', 'motogodziny [h]'),
    ],
  },
  {
    id: 'conveyor', name: 'Przenośnik taśmowy', category: 'Napędy', glyph: '📦', prefix: 'T',
    description: 'Napęd taśmy z czujnikiem obrotu i wyłącznikiem linkowym.',
    signals: [
      s('Zalacz', 'BOOL', 'załączenie napędu'),
      s('CzujnikObrotu', 'BOOL', 'kontrola ruchu taśmy'),
      s('WylLinkowy', 'BOOL', 'wyłącznik linkowy OK'),
    ],
  },

  /* ------------------------------ zawory --------------------------- */
  {
    id: 'valve-onoff', name: 'Zawór odcinający', category: 'Zawory i siłowniki', glyph: '🚰', prefix: 'V',
    description: 'Zawór dwustawny z krańcówkami położenia.',
    signals: [
      s('Otworz', 'BOOL', 'sterowanie otwarciem'),
      s('Otwarty', 'BOOL', 'potwierdzenie otwarcia'),
      s('Zamkniety', 'BOOL', 'potwierdzenie zamknięcia'),
    ],
  },
  {
    id: 'valve-ctrl', name: 'Zawór regulacyjny', category: 'Zawory i siłowniki', glyph: '🎚️', prefix: 'V',
    description: 'Zawór z siłownikiem proporcjonalnym sterowanym sygnałem 0–100%.',
    signals: [
      s('Otwarcie', 'REAL', 'zadane otwarcie [%]'),
      s('Polozenie', 'REAL', 'rzeczywiste otwarcie [%]'),
      s('Awaria', 'BOOL', 'usterka siłownika'),
    ],
  },
  {
    id: 'cylinder', name: 'Siłownik pneumatyczny dwustronny', category: 'Zawory i siłowniki', glyph: '🔧', prefix: 'C',
    description: 'Siłownik z zaworem 5/2 i czujnikami położeń krańcowych.',
    signals: [
      s('Wysun', 'BOOL', 'sterowanie wysuwem'),
      s('Wsun', 'BOOL', 'sterowanie wsuwem'),
      s('Wysuniety', 'BOOL', 'czujnik pozycji wysuniętej'),
      s('Wsuniety', 'BOOL', 'czujnik pozycji wsuniętej'),
    ],
  },
  {
    id: 'gripper', name: 'Chwytak', category: 'Zawory i siłowniki', glyph: '🦾', prefix: 'C',
    description: 'Chwytak pneumatyczny z potwierdzeniem uchwycenia detalu.',
    signals: [s('Zacisnij', 'BOOL', 'zamknięcie chwytaka'), s('Zaciśnięty', 'BOOL', 'detal uchwycony')],
  },

  /* --------------------------- aparatura --------------------------- */
  {
    id: 'pb-start', name: 'Przycisk START', category: 'Aparatura sterownicza', glyph: '🟢', prefix: 'S',
    description: 'Przycisk sterowniczy z zestykiem zwiernym (NO).',
    signals: [s('Przycisk', 'BOOL', 'naciśnięcie przycisku')],
  },
  {
    id: 'pb-stop', name: 'Przycisk STOP', category: 'Aparatura sterownicza', glyph: '🔴', prefix: 'S',
    description: 'Przycisk sterowniczy z zestykiem rozwiernym (NC) — w spoczynku daje sygnał TRUE.',
    signals: [s('Przycisk', 'BOOL', 'zestyk rozwierny — TRUE gdy nie naciśnięty')],
  },
  {
    id: 'estop', name: 'Wyłącznik awaryjny', category: 'Aparatura sterownicza', glyph: '🛑', prefix: 'S',
    description: 'Grzybkowy przycisk bezpieczeństwa z dwoma kanałami NC.',
    signals: [s('Kanal1', 'BOOL', 'kanał 1 — TRUE gdy zwolniony'), s('Kanal2', 'BOOL', 'kanał 2 — TRUE gdy zwolniony')],
  },
  {
    id: 'selector-3', name: 'Przełącznik trójpozycyjny', category: 'Aparatura sterownicza', glyph: '🎚️', prefix: 'S',
    description: 'Przełącznik trybu pracy: ręczny – zero – automatyczny.',
    signals: [s('Reczny', 'BOOL', 'pozycja RĘCZNY'), s('Auto', 'BOOL', 'pozycja AUTOMAT')],
  },
  {
    id: 'lamp', name: 'Lampka sygnalizacyjna', category: 'Aparatura sterownicza', glyph: '🔆', prefix: 'H',
    description: 'Lampka LED do sygnalizacji stanu na pulpicie.',
    signals: [s('Lampka', 'BOOL', 'załączenie lampki')],
  },
  {
    id: 'stack', name: 'Kolumna sygnalizacyjna', category: 'Aparatura sterownicza', glyph: '🚨', prefix: 'H',
    description: 'Trójsegmentowa wieża sygnalizacyjna z buzzerem.',
    signals: [
      s('Czerwona', 'BOOL', 'awaria'), s('Zolta', 'BOOL', 'ostrzeżenie'),
      s('Zielona', 'BOOL', 'praca'), s('Buzzer', 'BOOL', 'sygnał dźwiękowy'),
    ],
  },
  {
    id: 'safety-relay', name: 'Przekaźnik bezpieczeństwa', category: 'Zabezpieczenia', glyph: '🛡️', prefix: 'K',
    description: 'Moduł nadzorujący obwód bezpieczeństwa z potwierdzeniem zezwolenia.',
    signals: [
      s('Zezwolenie', 'BOOL', 'obwód bezpieczeństwa zamknięty'),
      s('Reset', 'BOOL', 'kasowanie po zadziałaniu'),
      s('Zadzialal', 'BOOL', 'przekaźnik wyzwolony'),
    ],
  },
  {
    id: 'door-lock', name: 'Zamek drzwi ochronnych', category: 'Zabezpieczenia', glyph: '🔒', prefix: 'K',
    description: 'Rygiel elektromagnetyczny osłony z kontrolą zamknięcia.',
    signals: [
      s('Zamkniete', 'BOOL', 'drzwi zamknięte'),
      s('Zaryglowane', 'BOOL', 'rygiel zamknięty'),
      s('Odblokuj', 'BOOL', 'żądanie odblokowania'),
    ],
  },
  {
    id: 'breaker', name: 'Wyłącznik silnikowy', category: 'Zabezpieczenia', glyph: '🔌', prefix: 'Q',
    description: 'Zabezpieczenie zwarciowe i przeciążeniowe z sygnalizacją stanu.',
    signals: [s('Zalaczony', 'BOOL', 'wyłącznik załączony'), s('Zadzialal', 'BOOL', 'zadziałanie zabezpieczenia')],
  },

  /* ----------------------------- procesy --------------------------- */
  {
    id: 'heater', name: 'Grzałka elektryczna', category: 'Urządzenia procesowe', glyph: '🔥', prefix: 'E',
    description: 'Element grzejny sterowany stycznikiem lub przekaźnikiem półprzewodnikowym.',
    signals: [s('Zalacz', 'BOOL', 'załączenie grzania'), s('Moc', 'REAL', 'moc zadana [%]'), s('Przegrzanie', 'BOOL', 'termostat zadziałał')],
  },
  {
    id: 'mixer', name: 'Mieszadło', category: 'Urządzenia procesowe', glyph: '🌀', prefix: 'M',
    description: 'Napęd mieszadła zbiornika z kontrolą obrotów.',
    signals: [s('Zalacz', 'BOOL', 'załączenie mieszadła'), s('Obroty', 'REAL', 'prędkość [obr/min]')],
  },
  {
    id: 'dosing', name: 'Dozownik', category: 'Urządzenia procesowe', glyph: '⚗️', prefix: 'Y',
    description: 'Podajnik lub pompa dozująca z zadaną dawką.',
    signals: [s('Dozuj', 'BOOL', 'rozpoczęcie dozowania'), s('Dawka', 'REAL', 'dawka zadana [kg]'), s('Podane', 'REAL', 'ilość podana [kg]')],
  },
  {
    id: 'fan', name: 'Wentylator', category: 'Urządzenia procesowe', glyph: '💨', prefix: 'M',
    description: 'Wentylator z presostatem potwierdzającym przepływ powietrza.',
    signals: [s('Zalacz', 'BOOL', 'załączenie wentylatora'), s('Przeplyw', 'BOOL', 'presostat — przepływ OK')],
  },
  {
    id: 'compressor', name: 'Sprężarka', category: 'Urządzenia procesowe', glyph: '🌬️', prefix: 'M',
    description: 'Sprężarka z regulacją dwupołożeniową ciśnienia w zbiorniku.',
    signals: [
      s('Zalacz', 'BOOL', 'załączenie sprężarki'),
      s('Cisnienie', 'REAL', 'ciśnienie w zbiorniku [bar]'),
      s('CisnienieMin', 'BOOL', 'presostat dolny'),
      s('CisnienieMax', 'BOOL', 'presostat górny'),
    ],
  },

  /* --------------------------- komunikacja ------------------------- */
  {
    id: 'hmi-panel', name: 'Panel operatorski', category: 'Komunikacja i system', glyph: '🖥️', prefix: 'HMI',
    description: 'Zestaw zmiennych wymiany danych z panelem HMI.',
    signals: [
      s('Ekran', 'INT', 'numer wyświetlanego ekranu'),
      s('PotwierdzAlarm', 'BOOL', 'potwierdzenie alarmów z panelu'),
      s('TrybAuto', 'BOOL', 'wybór trybu z panelu'),
    ],
  },
  {
    id: 'system', name: 'Sygnały systemowe sterownika', category: 'Komunikacja i system', glyph: '🧠', prefix: 'SYS',
    description: 'Standardowe znaczniki systemowe: zegary, pierwszy cykl, diagnostyka.',
    signals: [
      s('PierwszyCykl', 'BOOL', 'TRUE tylko w pierwszym cyklu po starcie'),
      s('Takt_1s', 'BOOL', 'impuls sekundowy'),
      s('Takt_100ms', 'BOOL', 'impuls 100 ms'),
      s('CzasCyklu', 'TIME', 'zmierzony czas cyklu'),
      s('BladKomunikacji', 'BOOL', 'utrata łączności z rozproszonym I/O'),
    ],
  },
  {
    id: 'remote-io', name: 'Rozproszone wejścia/wyjścia', category: 'Komunikacja i system', glyph: '🔗', prefix: 'IO',
    description: 'Moduł I/O na magistrali (Profinet, EtherCAT, Modbus TCP).',
    signals: [
      s('Online', 'BOOL', 'moduł dostępny'),
      s('Blad', 'BOOL', 'błąd modułu'),
      s('Wejscia', 'WORD', 'słowo wejść cyfrowych'),
      s('Wyjscia', 'WORD', 'słowo wyjść cyfrowych'),
    ],
  },
]

export const COMPONENT_CATEGORIES = Array.from(new Set(COMPONENTS.map((c) => c.category)))
