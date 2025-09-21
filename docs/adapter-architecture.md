# ioBroker Unraid Adapter – Architekturüberblick

Diese Notizen beschreiben den aktuellen Stand des neu aufgesetzten Adapters. Ziel ist es, ein solides Fundament zu haben, auf dem wir die Domänen und Datenpunkte iterativ ausbauen können, ohne bei jeder Erweiterung die Kernlogik anfassen zu müssen.

## 1. Gesamtablauf

1. **Adapterstart**
   - Einstellungen werden validiert (`baseUrl`, `apiToken`, `pollIntervalSeconds`, `allowSelfSigned`, `enabledDomains`).
   - Die durch den Nutzer konfigurierten Domänen werden über `expandSelection` in konkrete, von uns gepflegte Domänendefinitionen aufgelöst.
   - Die passenden GraphQL-Felder und ioBroker-State-IDs werden aus diesen Definitionen abgeleitet.
   - Vor dem ersten Poll werden alle zugehörigen States einmalig mit `null` erzeugt (`initializeStaticStates`), damit der Objektbaum sofort sichtbar ist.

2. **Polling**
   - Der `GraphQLSelectionBuilder` generiert aus den Domänendefinitionen die eigentliche Query.
   - `GraphQLClient` sendet sie an den konfigurierten `/graphql`-Endpunkt.
   - Das Ergebnis wird in `applyDefinition` anhand der definierten Pfade (`StateMapping.path`) in ioBroker-States geschrieben.
   - Der Scheduler triggert das Polling in dem gewünschten Intervall.

3. **Object-Hygiene**
   - Alle jemals benötigten Objekt-IDs werden aus Domänendefinitionen zusammengetragen (`collectStaticObjectIds`).
   - Beim Start werden fremde Objekte aus dem Namespace entfernt (`cleanupObjectTree`), um eine saubere Struktur zu behalten.

## 2. Domänenmodell

Die zentrale Datei `src/shared/unraid-domains.ts` bündelt sämtliche Metadaten:

- **`DomainNode`** – beschreibt die Baumstruktur, die in der Admin-UI angezeigt wird (Label, Standard-Auswahl, Kinder).
- **`DomainDefinition`** – verknüpft einen konkreten Domänenknoten mit den GraphQL-Selections und den ioBroker-States.
- **`FieldSpec` / `RootSelection`** – definieren, welche GraphQL-Felder je Root-Typ abgefragt werden.
- **`StateMapping`** – enthält die Ziel-State-ID, den Pfad innerhalb der GraphQL-Antwort und optionale Transformationen.

Aktuell gepflegte Domänen:

| Domäne          | Beschreibung                                      | Standard? |
|-----------------|----------------------------------------------------|-----------|
| `info.time`     | Aktuelle Systemzeit                                | ✔︎        |
| `info.os`       | Betriebssystem-Infos (Distribution, Release, Kernel) |          |
| `server.status` | Server-Basisdaten (Name, Status, LAN/WAN-IP, URLs) | ✔︎        |
| `metrics.cpu`   | CPU-Auslastung (gesamt in Prozent)                  | ✔︎        |
| `metrics.memory`| Arbeitsspeicher (Prozent, total/used/free in GByte) | ✔︎        |

**Wichtig:** Ein Domäneneintrag steht für ein „Datenpaket“. So liefert `server.status` bewusst mehrere States (`name`, `status`, `lanip`, …). Dadurch bleibt die Admin-UI schlank und wir haben die volle Kontrolle über die Struktur.

### Auswahl-Expander

`expandSelection` sorgt dafür, dass auch Elternknoten oder Gruppen in konkrete Definitionen übersetzt werden. Wenn der Nutzer z. B. nur `server` auswählt, werden automatisch alle darunterliegenden Domänen verarbeitet.

## 3. Admin-UI (React)

Die Administration greift direkt auf die Definition aus `src/shared/unraid-domains.ts` zu. Relevante Punkte in `admin/src/components/settings.tsx`:

- `domainTree` stellt den Baum dar; `defaultEnabledDomains` liefert die Initialauswahl.
- Bei Änderungen wird die Auswahl gefiltert (`DomainId`-Typisierung) und sortiert (`sortByTreeOrder`).
- Ancestor-Pflege (`pruneAncestors`) verhindert „hängende“ Elternknoten ohne aktive Kinder.

Damit ist sichergestellt, dass UI und Backend immer denselben Wissensstand teilen.

## 4. GraphQL Query Builder

`GraphQLSelectionBuilder` generiert stabilen Query-String:

1. Alle Root-Selections werden gesammelt.
2. Pro Root entsteht ein Baum (`FieldNode`), der nested Felder dedupliziert.
3. `build()` produziert eine formatierte Query vom Typ:

```graphql
query UnraidAdapterFetch {
    info {
        os {
            distro
            release
            kernel
        }
        time
    }
    server {
        lanip
        localurl
        name
        remoteurl
        status
        wanip
    }
}
```

Die Query bleibt deterministisch und kann leicht erweitert werden.

## 5. State-Anlage und Pflege

- `initializeStaticStates` sorgt bei jedem Start dafür, dass alle States existieren (mit `null`).
- `writeState` kümmert sich darum, dass die Kanalhierarchie existiert, bevor Werte gesetzt werden.
- `resolveValue` traversiert die GraphQL-Antwort nach den in `StateMapping.path` hinterlegten Pfaden.
- Optional lassen sich Transformationen (z. B. Einheitenskalierung) über `StateMapping.transform` ergänzen.

## 6. Erweiterungsvorgehen

1. **Domäne identifizieren** – Welche Felder/Funktionen aus `docs/schema.graphql` sollen aufgenommen werden?
2. **Baum erweitern** – Neuen `DomainNode` (mit Label + default) in `domainTreeDefinition` ergänzen.
3. **Definition schreiben** – `DomainDefinition` anlegen: GraphQL-Fields festhalten, State-Mappings definieren.
4. **UI-Labels hinzufügen** – Die passenden Übersetzungen in `admin/src/i18n/*.json` ergänzen.
5. **Tests / Lint** – `npm run lint` und `npm run check` sicherstellen.

### Beispiel: Weitere Serverdetails

- `FieldSpec`: `server { uptime owner { username } }` usw.
- `StateMapping`: `server.uptime.seconds` → `['server', 'uptime', 'timestamp']`, ggf. Transform-Funktion hinzufügen.

## 7. Bekannte Besonderheiten

- **Paketweise States:** Ein UI-Häkchen aktiviert bewusst mehrere States. Dies ist die aktuelle „Mismatch“-Erklärung zwischen UI-Auswahl und Objektbaum.
- **Kein Schema-Live-Lookup:** Damit wir volle Kontrolle behalten, wird das GraphQL-Schema nicht dynamisch abgefragt. Erweiterungen erfolgen manuell anhand von `docs/schema.graphql`.
- **Bootstrap ohne Daten:** Auch wenn der erste Poll scheitert, sind die Objekte bereits vorhanden (Werte `null`).

## 8. Nächste Schritte

Kurzfristig geplante Erweiterungen:

1. Feinere Aufteilung der Server-Daten (`status`, `netzwerk`, `urls`) – um Nutzer:innen mehr Granularität zu bieten.
2. Ergänzung weiterer Info-Blöcke (`metrics`, `array`, `docker`, …) mit klaren Paketdefinitionen.
3. Dokumentation für Migrationspfade, sobald wir existierende ioBroker-Installationen ablösen.

Diese Dokumentation wird bei jeder Funktionserweiterung gepflegt, damit neue Teammitglieder einen schnellen Einstieg behalten.
