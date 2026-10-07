/**
 * Texts of the native menus and dialogs the main process shows (F11.2): the web app is translated
 * with ngx-translate; these few open before or outside it. One dictionary per language — the
 * app's language from the desktop config (set by the window when the profile changes), else the
 * system's. German in du-form like the app. Pure: unit-tested without Electron.
 */
export const DESKTOP_LOCALES = ['de-CH', 'en'] as const;
export type DesktopLocale = (typeof DESKTOP_LOCALES)[number];

export function isDesktopLocale(value: unknown): value is DesktopLocale {
  return (
    typeof value === 'string' &&
    (DESKTOP_LOCALES as readonly string[]).includes(value)
  );
}

/** The system's language (`app.getLocale()`, e.g. `de-CH`, `en-US`) → de-CH for any German. */
export function systemLocale(locale: string | undefined): DesktopLocale {
  return (locale ?? '').toLowerCase().startsWith('de') ? 'de-CH' : 'en';
}

export interface DesktopMessages {
  readonly foreignLock: {
    readonly title: string;
    readonly message: string;
    readonly detail: (host: string, since: string, dir: string) => string;
    readonly quit: string;
    readonly openAnyway: string;
  };
  readonly conflictCopies: {
    readonly title: string;
    readonly message: string;
    readonly detail: (files: string[]) => string;
    readonly ok: string;
  };
  readonly syncFolder: (provider: string) => string;
  readonly chooseFolder: string;
  readonly switchExisting: {
    readonly title: string;
    readonly message: string;
    readonly detail: string;
    readonly open: string;
    readonly cancel: string;
  };
  readonly switchEmpty: {
    readonly title: string;
    readonly message: string;
    readonly detail: string;
    readonly copy: string;
    readonly empty: string;
    readonly cancel: string;
  };
  readonly foreignLockTarget: string;
  readonly viewMenu: string;
  readonly about: {
    readonly menu: string;
    readonly item: string;
    readonly detail: (
      electron: string,
      chrome: string,
      node: string,
      dataDir: string,
    ) => string;
  };
  readonly fatal: {
    readonly title: string;
    readonly detail: (error: string) => string;
  };
  readonly startFailed: {
    readonly title: string;
    readonly detail: (error: string, dir: string) => string;
  };
}

const DE_CH: DesktopMessages = {
  foreignLock: {
    title: 'Daten werden anderswo bearbeitet',
    message: 'Die Daten werden gerade auf einem anderen Gerät bearbeitet.',
    detail: (host, since, dir) =>
      `Gerät: ${host}\nZuletzt aktiv: ${since}\nOrdner: ${dir}\n\n` +
      'Wenn zwei Geräte gleichzeitig mit demselben (synchronisierten) Ordner arbeiten, kann der ' +
      'Sync-Dienst Änderungen überschreiben. Schliesse lazy-koins zuerst auf dem anderen Gerät ' +
      'und warte, bis die Synchronisation fertig ist.',
    quit: 'Beenden',
    openAnyway: 'Trotzdem öffnen',
  },
  conflictCopies: {
    title: 'Sync-Konflikt',
    message: 'Im Datenordner liegen Konfliktkopien der Datenbank.',
    detail: (files) =>
      `${files.join('\n')}\n\nDer Sync-Dienst hat sie angelegt, weil die Daten auf zwei Geräten ` +
      'gleichzeitig geändert wurden. lazy-koins arbeitet mit "lazykoins.db" weiter; prüfe, ob in ' +
      'einer Kopie Änderungen fehlen, und lösche die Kopien danach.',
    ok: 'Verstanden',
  },
  syncFolder: (provider) =>
    `Dieser Ordner wird von ${provider} synchronisiert. Öffne lazy-koins nie gleichzeitig auf ` +
    'zwei Geräten mit diesem Ordner und warte nach dem Beenden, bis die Synchronisation fertig ' +
    'ist. lazy-koins warnt beim Start, wenn die Daten gerade auf einem anderen Gerät offen sind.',
  chooseFolder: 'Speicherort für lazy-koins wählen',
  switchExisting: {
    title: 'Speicherort wechseln',
    message: 'In diesem Ordner gibt es bereits lazy-koins-Daten.',
    detail:
      'Diese Daten öffnen? Die Daten am bisherigen Ort bleiben unverändert dort.',
    open: 'Vorhandene Daten öffnen',
    cancel: 'Abbrechen',
  },
  switchEmpty: {
    title: 'Speicherort wechseln',
    message: 'Die bisherigen Daten in den neuen Ordner kopieren?',
    detail:
      'Kopieren: alle Projekte und Dateien kommen mit, die alten bleiben als Sicherung am ' +
      'bisherigen Ort. Leer beginnen: der neue Ordner startet ohne Daten.',
    copy: 'Kopieren und wechseln',
    empty: 'Leer beginnen',
    cancel: 'Abbrechen',
  },
  foreignLockTarget:
    'Die Daten in diesem Ordner sind gerade auf einem anderen Gerät geöffnet. Wechsle erst, ' +
    'wenn lazy-koins dort beendet und synchronisiert ist.',
  viewMenu: 'Ansicht',
  about: {
    menu: 'Hilfe',
    item: 'Über lazy-koins',
    detail: (electron, chrome, node, dataDir) =>
      `Electron ${electron} · Chromium ${chrome} · Node ${node}\nDatenordner: ${dataDir}\n\n` +
      'Keine Steuerberatung.',
  },
  fatal: {
    title: 'lazy-koins – unerwarteter Fehler',
    detail: (error) =>
      `lazy-koins konnte nicht weiterlaufen und wird beendet.\n\n${error}\n\n` +
      'Deine Daten wurden nicht verändert. Falls der Fehler bleibt: lazy-koins neu installieren ' +
      'oder den Fehlertext melden.',
  },
  startFailed: {
    title: 'lazy-koins kann nicht starten',
    detail: (error, dir) =>
      `${error}\n\nDatenordner: ${dir}\n\nDie Daten wurden nicht verändert.`,
  },
};

const EN: DesktopMessages = {
  foreignLock: {
    title: 'Data is being edited elsewhere',
    message: 'The data is currently being edited on another device.',
    detail: (host, since, dir) =>
      `Device: ${host}\nLast active: ${since}\nFolder: ${dir}\n\n` +
      'If two devices work with the same (synced) folder at the same time, the sync service ' +
      'can overwrite changes. Close lazy-koins on the other device first and wait until the ' +
      'sync has finished.',
    quit: 'Quit',
    openAnyway: 'Open anyway',
  },
  conflictCopies: {
    title: 'Sync conflict',
    message: 'The data folder contains conflict copies of the database.',
    detail: (files) =>
      `${files.join('\n')}\n\nThe sync service created them because the data was changed on ` +
      'two devices at the same time. lazy-koins continues with "lazykoins.db"; check whether a ' +
      'copy holds changes that are missing, then delete the copies.',
    ok: 'Got it',
  },
  syncFolder: (provider) =>
    `This folder is synced by ${provider}. Never open lazy-koins on two devices with this ` +
    'folder at the same time, and after quitting wait until the sync has finished. lazy-koins ' +
    'warns at start when the data is open on another device.',
  chooseFolder: 'Choose the data folder for lazy-koins',
  switchExisting: {
    title: 'Change data folder',
    message: 'This folder already contains lazy-koins data.',
    detail:
      'Open this data? The data in the previous location stays there unchanged.',
    open: 'Open existing data',
    cancel: 'Cancel',
  },
  switchEmpty: {
    title: 'Change data folder',
    message: 'Copy the current data to the new folder?',
    detail:
      'Copy: all projects and files come along, the old ones stay in the previous location as ' +
      'a backup. Start empty: the new folder starts without data.',
    copy: 'Copy and switch',
    empty: 'Start empty',
    cancel: 'Cancel',
  },
  foreignLockTarget:
    'The data in this folder is currently open on another device. Switch only once lazy-koins ' +
    'has been closed there and the sync has finished.',
  viewMenu: 'View',
  about: {
    menu: 'Help',
    item: 'About lazy-koins',
    detail: (electron, chrome, node, dataDir) =>
      `Electron ${electron} · Chromium ${chrome} · Node ${node}\nData folder: ${dataDir}\n\n` +
      'No tax advice.',
  },
  fatal: {
    title: 'lazy-koins – unexpected error',
    detail: (error) =>
      `lazy-koins could not continue and will quit.\n\n${error}\n\n` +
      'Your data was not changed. If the error persists: reinstall lazy-koins or report the ' +
      'error text.',
  },
  startFailed: {
    title: 'lazy-koins cannot start',
    detail: (error, dir) =>
      `${error}\n\nData folder: ${dir}\n\nThe data was not changed.`,
  },
};

export const MESSAGES_BY_LOCALE: Readonly<
  Record<DesktopLocale, DesktopMessages>
> = {
  'de-CH': DE_CH,
  en: EN,
};

/** German — the texts before F11.2. */
export const MESSAGES = DE_CH;

export function desktopMessages(locale: DesktopLocale): DesktopMessages {
  return MESSAGES_BY_LOCALE[locale];
}
