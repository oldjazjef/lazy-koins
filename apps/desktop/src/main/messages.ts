/**
 * Texts of the native dialogs the main process shows (German, du-form like the app). The web app
 * is translated with ngx-translate; these few dialogs open before or outside it.
 */
export const MESSAGES = {
  foreignLock: {
    title: 'Daten werden anderswo bearbeitet',
    message: 'Die Daten werden gerade auf einem anderen Gerät bearbeitet.',
    detail: (host: string, since: string, dir: string) =>
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
    detail: (files: string[]) =>
      `${files.join('\n')}\n\nDer Sync-Dienst hat sie angelegt, weil die Daten auf zwei Geräten ` +
      'gleichzeitig geändert wurden. lazy-koins arbeitet mit "lazykoins.db" weiter; prüfe, ob in ' +
      'einer Kopie Änderungen fehlen, und lösche die Kopien danach.',
    ok: 'Verstanden',
  },
  syncFolder: (provider: string) =>
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
  about: {
    menu: 'Hilfe',
    item: 'Über lazy-koins',
    detail: (electron: string, chrome: string, node: string, dataDir: string) =>
      `Electron ${electron} · Chromium ${chrome} · Node ${node}\nDatenordner: ${dataDir}\n\n` +
      'Keine Steuerberatung.',
  },
  fatal: {
    title: 'lazy-koins – unerwarteter Fehler',
    detail: (error: string) =>
      `lazy-koins konnte nicht weiterlaufen und wird beendet.\n\n${error}\n\n` +
      'Deine Daten wurden nicht verändert. Falls der Fehler bleibt: lazy-koins neu installieren ' +
      'oder den Fehlertext melden.',
  },
  startFailed: {
    title: 'lazy-koins kann nicht starten',
    detail: (error: string, dir: string) =>
      `${error}\n\nDatenordner: ${dir}\n\nDie Daten wurden nicht verändert.`,
  },
} as const;
