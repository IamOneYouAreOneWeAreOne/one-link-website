import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import worker from '../src/worker.js';


const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const ORIGIN = 'https://weareone-link.org';

function request(route, headers = {}) {
  return new Request(`${ORIGIN}${route}`, { headers });
}

async function fetchRoute(route, { env = {}, headers = {} } = {}) {
  return worker.fetch(request(route, headers), env, {});
}

function signedAttestationDocument(sha) {
  return {
    artifact: { sha256: sha },
    signatures: [{
      scheme: 'ed25519',
      public_key_hex: '1'.repeat(64),
      signature_hex: '2'.repeat(128),
    }],
  };
}

const LOCALIZED_SURFACES = [
  { code: 'en', prefix: '' },
  { code: 'es', prefix: 'es' },
  { code: 'fr', prefix: 'fr' },
  { code: 'de', prefix: 'de' },
  { code: 'pt', prefix: 'pt' },
  { code: 'it', prefix: 'it' },
];

const TRUTH_WORDS = {
  prerelease: /pre[- ]?release|prerelease|preview|versi[oó]n preliminar|preliminar|pr[ée]version|vorabversion|vorabkanal|anteprima|pr[ée]via/iu,
  relay: /relay|rel[eé]|relais/iu,
  staticScope: /static|snapshot|build[- ]time|est[aá]tic|instant[aá]nea|statique|aper[cç]u|statisch|momentaufnahme|static[oa]|pr[ée]via/iu,
  metadata: /metadata|metadatos|m[ée]tadonn[ée]es|metadaten|metadati|metadados/iu,
  presence: /presence|presencia|pr[ée]sence|pr[aä]senz|presenza|presen[cç]a/iu,
  visitor: /visitors?|visitantes?|visiteurs?|besucher|visitatori/iu,
  selfTest: /self[- ]?test|autoprueba|autotest|selbsttest|autoteste/iu,
  secondDevice: /second device|segundo dispositivo|second appareil|deuxi[eè]me appareil|zweites ger[aä]t|secondo dispositivo/iu,
  dependency: /depend|dependency|depende|dependencia|d[ée]pend|d[ée]pendance|abh[aä]ng|abh[aä]ngigkeit|dipend|dipendenza|depend[eê]ncia/iu,
  stale: /stale|expired|out of date|desactualiz|caduc|obsol|expir|p[ée]rim|veraltet|abgelaufen|scadut|desatualiz/iu,
};

const RISKY_COPY = {
  titleMetadata: [
    /One Link collects nothing|One Link no recopila nada|One Link ne collecte rien|One Link sammelt nichts|One Link não recolhe nada|One Link non raccoglie nulla/iu,
    /The mesh - every One Link node, live|La malla - cada nodo de One Link, en vivo|Le maillage - chaque n[œo]ud One Link, en direct|Das Mesh - jeder One-Link-Knoten, live|A malha - cada n[oó] de One Link, ao vivo|Il mesh - ogni nodo One Link, dal vivo/iu,
  ],
  capability: [
    /\/api\/status/iu,
    /(?:updated|actualizado|mis [aà] jour|aktualisiert|aggiornato|atualizado).{0,12}(?:2\s*s|2s)/iu,
    /(?:page|p[aá]gina|seite|pagina).{0,40}(?:is the truth|es la verdad|est la v[ée]rit[ée]|ist die wahrheit|[èe] la verit[aà]|[ée] a verdade)/iu,
    /cannot lie|no podemos mentir|nous ne pouvons pas mentir|wir k[oö]nnen.{0,12}nicht l[üu]gen|non possiamo mentire|n[aã]o podemos mentir/iu,
  ],
  metadata: [
    /no servers? (?:in the middle|between)|sin servidores? en medio|pas de serveurs? au milieu|keine server dazwischen|niente server in mezzo|sem servidores? no meio/iu,
    /complete anonymity|total anonymity|anonimato total|anonymat complet|vollst[aä]ndige anonymit[aä]t|anonimato totale/iu,
    /only you and (?:they|the recipient).{0,20}(?:can )?read|solo t[uú] y (?:ellos|el destinatario).{0,20}(?:pueden|puede) leer|vous seul.{0,30}pouvez le lire|nur (?:du|sie).{0,30}k[oö]nnen es lesen|solo tu.{0,30}potete legger|apenas voc[eê].{0,30}podem ler/iu,
    /never identifying data|nunca datos identificativos|aucune donn[ée]e d.identification,? jamais|niemals identifizierende daten|mai dati identificativi|nunca dados identificadores/iu,
  ],
  share: [
    /without a size limit|no size limit|sin l[ií]mite de tama[ñn]o|sans limite de taille|ohne gr[oö][sß]enlimit|senza limite di dimensione|sem limite de tamanho/iu,
    /without server retention|sin retenci[oó]n (?:en )?servidor|sans r[ée]tention serveur|ohne server-aufbewahrung|senza ritenzione (?:sul )?server|sem reten[cç][aã]o (?:em )?servidor/iu,
  ],
  mesh: [
    /every (?:dot|active node).{0,40}(?:real|live)|cada (?:punto|nodo activo).{0,40}(?:real|en vivo)|chaque (?:point|n[œo]ud actif).{0,40}(?:v[ée]ritable|direct)|jeder (?:punkt|aktive knoten).{0,40}(?:echt|live)|ogni (?:punto|nodo attivo).{0,40}(?:vero|dal vivo)|cada (?:ponto|n[oó] ativo).{0,40}(?:real|ao vivo)/iu,
    /no IPs|sin IPs|pas d.IP|keine IPs|niente IP|sem IPs/iu,
    /(?:chat|conversation|conversa).{0,24}(?:anonymous|an[oó]nim|anonym|anonim)/iu,
  ],
  privacy: [
    /we (?:collect|gather) nothing|no recopilamos nada|nous ne collectons rien|wir sammeln nichts|non raccogliamo nulla|n[aã]o recolhemos nada/iu,
    /relays? (?:log|record) nothing|los rel[eé]s no registran nada|les relais ne consignent rien|die relays protokollieren nichts|i relay non registrano nulla|os rel[ée]s n[aã]o registam nada/iu,
    /information (?:lives|exists) only on.{0,30}devices|la informaci[oó]n vive solo en los dispositivos|l.information vit uniquement sur les appareils|die information lebt nur auf den ger[aä]ten|le informazioni vivono solo sui dispositivi|a informa[cç][aã]o vive apenas nos dispositivos/iu,
    /free,? forever|gratis para siempre|gratuit pour toujours|kostenlos,? f[üu]r immer|gratuito per sempre|gratuito para sempre/iu,
  ],
  security: [
    /no (?:request )?logs?.{0,30}(?:you|visitor)|sin registros? de petici[oó]n|pas de journaux? de requ[êe]te|keine anfrage-logs|nessun log di richiesta|sem registos? de pedido/iu,
    /no way to (?:find|discover) out|no hay forma de (?:saber|descubrir)|aucun moyen de le savoir|keinen weg,? es herauszufinden|nessun modo di scoprir|n[aã]o h[aá] forma de descobrir/iu,
    /active everywhere today|vivas en todas partes hoy|actives partout aujourd.hui|heute [üu]berall aktiv|attive ovunque oggi|vivas em todo o lado hoje/iu,
    /PQ hybrid by default|h[ií]brido post.?cu[aá]ntico por defecto|hybride post.?quantique par d[ée]faut|post.?quanten.?hybrid standardm[aä][sß]ig|ibrido post.?quantistico per impostazione predefinita|h[ií]brido p[oó]s.?qu[aâ]ntico por defeito/iu,
  ],
  disclosure: [
    /We acknowledge within 72 hours|Acusamos recibo en 72 horas|Nous accusons r[ée]ception sous 72 heures|Wir best[aä]tigen innerhalb von 72 Stunden|Acusamos a rece[cç][aã]o em 72 horas|Confermiamo entro 72 ore/iu,
    /Coordinated disclosure is honored|La divulgaci[oó]n coordinada se respeta|La divulgation coordonn[ée]e est honor[ée]e|Koordinierte Offenlegung wird respektiert|A divulga[cç][aã]o coordenada [ée] honrada|La divulgazione coordinata [èe] rispettata/iu,
    /CVE assignment via MITRE|asignaci[oó]n de CVE v[ií]a MITRE|attribution de CVE via MITRE|CVE-Zuweisung [üu]ber MITRE|atribui[cç][aã]o de CVE via MITRE|assegnazione di CVE tramite MITRE/iu,
    /CVE assignment for qualifying findings|Permanent commit-message credit|cr[ée]dito permanente en el mensaje de commit|cr[ée]dit permanent dans le message de commit|dauerhafte Commit-Message-W[üu]rdigung|cr[ée]dito permanente na mensagem de commit|credito permanente nel messaggio di commit/iu,
    /A funded bounty program will open|Un programa de recompensas con fondos abrir[aá]|Un programme financ[ée] ouvrira|Ein finanziertes Bounty-Programm wird er[oö]ffnen|Um programa financiado abrir[aá]|Un programma finanziato aprir[aà]/iu,
    /Good-faith research.{0,80}will not result in legal action|La investigaci[oó]n de buena fe.{0,80}no acarrear[aá] acciones legales|La recherche de bonne foi.{0,80}n.entra[iî]nera ni action en justice|Gutgl[aä]ubige Forschung.{0,80}f[üu]hrt nicht zu rechtlichen Schritten|A investiga[cç][aã]o de boa-f[ée].{0,80}n[aã]o resultar[aá] em a[cç][oõ]es legais|La ricerca in buona fede.{0,80}non porter[aà] ad azioni legali/iu,
    /(?:Encrypt|Cifra|Chiffrez|Verschl[üu]sseln|Cifre).{0,80}\/share\/.{0,80}(?:app|App)/iu,
  ],
  infrastructure: [
    /would not stop One Link|no detendr[ií]a One Link|n.arr[êe]terait pas One Link|w[üu]rde One Link nicht stoppen|non fermerebbe One Link|n[aã]o pararia One Link/iu,
    /no client ever (?:calls|contacts)|ning[uú]n cliente llama jam[aá]s|aucun client n.appelle|kein client ruft jemals|nessun client chiama mai|nenhum cliente chama/iu,
    /not a load-bearing dependency|no es una dependencia (?:portante|fundamental)|pas une d[ée]pendance portante|keine tragende abh[aä]ngigkeit|non una dipendenza portante|n[aã]o uma depend[eê]ncia portante/iu,
    /continues? (?:to work )?with or without us|sigue funcionando.{0,20}con o sin nosotros|continue de fonctionner.{0,20}avec ou sans nous|l[aä]uft.{0,20}mit oder ohne uns|continua a funzionare.{0,20}con o senza di noi|continua a funcionar.{0,20}com ou sem n[oó]s/iu,
  ],
  accessibility: [
    /live (?:pair(?:ing)?|QR).{0,40}demo|demostraci[oó]n en vivo de emparejamiento|d[ée]monstration en direct d.appairage|pair-by-QR-live-demo|demo dal vivo di abbinamento|demonstra[cç][aã]o ao vivo de emparelhamento/iu,
    /continuously updated|actualizada continuamente|mise [aà] jour en continu|kontinuierlich aktualisierte|aggiornata continuamente|atualizada continuamente/iu,
  ],
  builders: [
    /rekey every N|rotaci[oó]n de claves cada N|rotation de cl[ée] tous les N|Rekey alle N|rota[cç][aã]o de chave a cada N|rotazione di chiave ogni N/iu,
    /k-of-n share split with BN multi-sig|divisi[oó]n k-de-n con multifirma BN|partage k-parmi-n avec multi-signature BN|k-aus-n-Share-Split mit BN-Multisig|divis[aã]o k-de-n com multiassinatura BN|suddivisione k-su-n con multi-firma BN/iu,
    /Hardware backends.{0,100}plug in|respaldos hardware.{0,100}se enchufan|backends mat[ée]riels.{0,100}se branchent|Hardware-Backends.{0,100}anschlie[sß]en|Backends de hardware.{0,100}encaixam|backend hardware.{0,100}si innestano/iu,
    /field-gradient followers|siguen el gradiente del campo|suivent le gradient du champ|folgen dem Feldgradienten|seguem o gradiente do campo|seguono il gradiente del campo/iu,
    /believable empty account|cuenta vac[ií]a cre[ií]ble|compte vide cr[ée]dible|glaubhaftes leeres Konto|conta vazia cred[ií]vel|account vuoto credibile/iu,
  ],
  roadmap: [
    /silent loss is impossible|la p[ée]rdida silenciosa es imposible|la perte silencieuse est impossible|stiller Verlust ist unm[oö]glich|a perda silenciosa [ée] imposs[ií]vel|la perdita silenziosa [èe] impossibile/iu,
    /no remote-pair attack surface|sin superficie de ataque de emparejamiento remoto|aucune surface d.attaque d.appairage distant|keine Remote-Pair-Angriffsfl[aä]che|sem superf[ií]cie de ataque de emparelhamento remoto|nessuna superficie d.attacco per l.abbinamento remoto/iu,
    /timing tells nothing|los tiempos no digan nada|la temporalit[ée] ne dise rien|Timing nichts verr[aä]t|o tempo n[aã]o diga nada|i tempi non dicano nulla/iu,
    /malware.{0,80}(?:administrator|administrador|administrateur|Administratorrechten|amministratore).{0,100}(?:cannot|no puede|ne peut|kann.{0,20}nicht|n[aã]o consegue|non pu[oò]).{0,40}(?:extract|extraer|extraire|extrahieren|extrair|estrarre)/iu,
    /<h3>Telemetry of any kind\.<\/h3>|<h3>Telemetr[ií]a de cualquier tipo\.<\/h3>|<h3>T[ée]l[ée]m[ée]trie de quelque nature que ce soit\.<\/h3>|<h3>Telemetrie jeglicher Art\.<\/h3>|<h3>Telemetria de qualquer tipo\.<\/h3>|<h3>Telemetria di qualsiasi tipo\.<\/h3>/iu,
  ],
  signed404: [
    /signed binaries for every platform|binarios firmados y gratuitos para cada plataforma|binaires sign[ée]s et gratuits pour chaque plateforme|signierte bin[aä]rdateien f[üu]r jede plattform|binari firmati e gratuiti per ogni piattaforma|bin[aá]rios assinados e gratuitos para cada plataforma/iu,
    /every active One Link node|cada nodo activo de One Link|chaque n[œo]ud One Link actif|jeder aktive One Link knoten|ogni nodo One Link attivo|cada n[oó] One Link ativo/iu,
  ],
};

const OPERATIONAL_AUTOINSTALL_CLAIMS = [
  /(?:auto[- ]?install(?:ation| updates?)?|automatic(?: update)? installation|instalaci[oó]n autom[aá]tica|installation automatique|automatische (?:installation|update-installation)|instala[cç][aã]o autom[aá]tica|installazione automatica).{0,80}(?:on|enabled|activad[ao]|activ[ée]e|aktiviert|ativad[ao]|abilitat[ao]|attiv[ao]).{0,30}(?:by default|por defecto|par d[ée]faut|standardm[aä][sß]ig|por defeito|per impostazione predefinita)/iu,
  /silent background install|installs? silently in the background|instalaci[oó]n silenciosa en segundo plano|installation silencieuse en arri[èe]re-plan|stille hintergrundinstallation|instala[cç][aã]o silenciosa em segundo plano|installazione silenziosa in background/iu,
];

function localizedPath(prefix, slug) {
  const base = path.join(ROOT, 'dist', 'weareone-link.org', prefix);
  if (slug === '404') return path.join(base, '404.html');
  if (slug === 'index') return path.join(base, 'index.html');
  return path.join(base, slug, 'index.html');
}

async function localizedPage(locale, slug) {
  return readFile(localizedPath(locale.prefix, slug), 'utf8');
}

function assertNone(text, patterns, label) {
  for (const pattern of patterns) assert.doesNotMatch(text, pattern, `${label}: ${pattern}`);
}

function descriptionMetadata(html) {
  return [...html.matchAll(/<meta\s+[^>]*(?:name|property)="(?:description|og:description|twitter:description)"[^>]*>/giu)]
    .map(match => match[0])
    .join('\n');
}

function titleMetadata(html) {
  return [...html.matchAll(/(?:<title>[\s\S]*?<\/title>|<meta\s+[^>]*(?:property|name)="(?:og:title|twitter:title)"[^>]*>)/giu)]
    .map(match => match[0])
    .join('\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function uniqueArticleByHeading(html, heading, label) {
  const pattern = new RegExp(
    `<article\\b[^>]*>(?:(?!</article>)[\\s\\S])*?<h3[^>]*>\\s*${escapeRegExp(heading)}\\s*</h3>(?:(?!</article>)[\\s\\S])*</article>`,
    'gu',
  );
  const matches = [...html.matchAll(pattern)];
  assert.equal(matches.length, 1, `${label}: expected one article, found ${matches.length}`);
  return matches[0][0];
}

function uniqueArticleByClaimId(html, claimId, label) {
  const pattern = new RegExp(
    `<article\\b[^>]*\\bdata-claim-id="${escapeRegExp(claimId)}"[^>]*>[\\s\\S]*?</article>`,
    'gu',
  );
  const matches = [...html.matchAll(pattern)];
  assert.equal(matches.length, 1, `${label}: expected one claim article, found ${matches.length}`);
  return matches[0][0];
}

function sectionsByClaimScope(html, claimScope) {
  const pattern = new RegExp(
    `<section\\b[^>]*\\bdata-claim-scope="${escapeRegExp(claimScope)}"[^>]*>(?:(?!</section>)[\\s\\S])*</section>`,
    'gu',
  );
  return [...html.matchAll(pattern)].map(match => match[0]);
}

function assertRecentOrMarkedStale(html, label, maxAgeDays = 45) {
  const firstDate = html.match(/\b(20\d{2}-\d{2}-\d{2})\b/u);
  if (!firstDate) return;
  const ageDays = (Date.now() - Date.parse(`${firstDate[1]}T00:00:00Z`)) / 86_400_000;
  if (ageDays > maxAgeDays) {
    assert.match(html, TRUTH_WORDS.stale, `${label}: ${firstDate[1]} is stale but is not labelled stale/expired`);
  }
}

function assertRfcWeekday(value, label) {
  const weekday = value.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat),/u)?.[1];
  assert.ok(weekday, `${label}: missing RFC 822 weekday`);
  const parsed = new Date(value);
  assert.ok(!Number.isNaN(parsed.valueOf()), `${label}: invalid date`);
  assert.equal(weekday, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parsed.getUTCDay()], `${label}: weekday does not match date`);
  return parsed;
}

function assertFutureRefreshOrMarkedStale(html, label) {
  const refresh = html.match(/(?:next[_ -]?(?:update|refresh)|siguiente[_ -]?refresco|prochain[_ -]?rafra[iî]chis|n[aä]chste[_ -]?aktualisierung|prossimo[_ -]?aggiornamento|proximo[_ -]?refresco)[^\n<]*<\/span>:\s*(20\d{2}-\d{2}-\d{2})/iu);
  if (!refresh) return;
  const refreshAt = Date.parse(`${refresh[1]}T23:59:59Z`);
  if (refreshAt < Date.now()) {
    assert.match(html, TRUTH_WORDS.stale, `${label}: promised refresh ${refresh[1]} has expired without an expiry label`);
  }
}

test('explicit macOS Intel installer fails without redirecting to arm64', async () => {
  const response = await fetchRoute('/download/macos-x86_64', {
    headers: { Accept: 'text/html' },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Location'), null);
  const body = await response.text();
  assert.match(body, /No macOS Intel artifact is published/i);
  assert.doesNotMatch(body, /releases\/download\/auto-latest\/one-link-macos-arm64\.dmg/);
});

test('explicit macOS Intel portable route also fails clearly', async () => {
  const response = await fetchRoute('/download/macos-x86_64-zip', {
    headers: { Accept: 'application/json' },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Location'), null);
  const body = await response.json();
  assert.equal(body.error, 'macOS Intel artifact unavailable');
  assert.deepEqual(body.available, ['macos-arm64', 'macos-arm64-zip']);
});

test('conflicting architecture suffixes cannot smuggle an arm64 redirect', async () => {
  for (const route of [
    '/download/macos-x86_64-arm64',
    '/download/macos-amd64-aarch64',
    '/download/macos-x86_64-zip-installer',
    '/download/source-arm64',
    '/download/android-zip',
  ]) {
    const response = await fetchRoute(route, {
      headers: { Accept: 'application/json' },
    });
    assert.equal(response.status, 404, route);
    assert.equal(response.headers.get('Location'), null, route);
  }
});

test('auto routing never guesses a Windows artifact for an unknown client', async () => {
  const jsonResponse = await fetchRoute('/download/auto', {
    headers: { Accept: 'application/json', 'User-Agent': 'custom-transfer-client/1' },
  });
  assert.equal(jsonResponse.status, 300);
  assert.equal(jsonResponse.headers.get('Location'), null);
  assert.equal((await jsonResponse.json()).error, 'platform selection required');

  const browserResponse = await fetchRoute('/download/auto', {
    headers: { Accept: 'text/html', 'User-Agent': 'custom-browser/1' },
  });
  assert.equal(browserResponse.status, 302);
  assert.equal(browserResponse.headers.get('Location'), '/download/');
});

test('ambiguous and auto-detected macOS routes require a choice', async () => {
  const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
  for (const route of ['/download/macos', '/download/auto']) {
    const response = await fetchRoute(route, {
      headers: { Accept: 'text/html', 'User-Agent': safari },
    });
    assert.equal(response.status, 300, route);
    assert.equal(response.headers.get('Location'), null, route);
    assert.match(await response.text(), /Choose your macOS architecture/i);
  }
});

test('supported desktop artifacts remain downloadable on rolling channel', async () => {
  const cases = [
    ['/download/windows-x86_64', 'one-link-setup-x86_64.exe'],
    ['/download/windows-arm64-zip', 'one-link-windows-arm64.zip'],
    ['/download/macos-arm64', 'one-link-macos-arm64.dmg'],
    ['/download/macos-arm64-zip', 'one-link-macos-arm64.zip'],
    ['/download/linux-x86_64', 'one-link-linux-x86_64.AppImage'],
    ['/download/linux-arm64-zip', 'one-link-linux-arm64.zip'],
  ];
  for (const [route, asset] of cases) {
    const response = await fetchRoute(route);
    assert.equal(response.status, 302, route);
    assert.equal(
      response.headers.get('Location'),
      `https://github.com/coherence-energy-labs/one-link/releases/download/auto-latest/${asset}`,
      route,
    );
    assert.equal(response.headers.get('X-One-Link-Release-Channel'), 'continuous');
    assert.equal(response.headers.get('X-One-Link-Version-Pinned'), 'false');
    assert.equal(response.headers.get('X-One-Link-Artifact-Signature'), 'not-published');
  }
});

test('programmatic release metadata never upgrades a rolling checksum into a signature', async () => {
  const response = await fetchRoute('/download/windows-x86_64', {
    headers: { Accept: 'application/json' },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.release, {
    channel: 'continuous',
    tag: 'auto-latest',
    version_pinned: false,
    mutable: true,
    immutability: 'rolling-channel',
  });
  assert.equal(body.integrity.sha256, null);
  assert.equal(body.integrity.signature, 'not-published');
  assert.equal(body.integrity.attestation, 'not-published');
  assert.equal(body.integrity.reproducible_build, 'not-verified');
});

test('an explicit version tag pins routes but does not invent proof', async () => {
  const response = await fetchRoute('/download/linux-x86_64', {
    env: { VERSIONED_RELEASE_TAG: 'v1.2.3-rc.1' },
    headers: { Accept: 'application/json' },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.url, 'https://github.com/coherence-energy-labs/one-link/releases/download/v1.2.3-rc.1/one-link-linux-x86_64.AppImage');
  assert.equal(body.release.channel, 'versioned');
  assert.equal(body.release.version_pinned, true);
  assert.equal(body.release.mutable, true);
  assert.equal(body.release.immutability, 'not-enforced');
  assert.equal(body.integrity.signature, 'not-published');
});

test('invalid version configuration fails closed', async () => {
  const response = await fetchRoute('/download/windows-x86_64', {
    env: { VERSIONED_RELEASE_TAG: 'auto-latest' },
    headers: { Accept: 'application/json' },
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /misconfigured/);
});

test('attestation fixtures are never served as current release proof', async () => {
  let assetFetches = 0;
  const sha = 'a'.repeat(64);
  const response = await fetchRoute(`/api/attest/${sha}`, {
    env: {
      ASSETS: { fetch: async () => { assetFetches += 1; return new Response('{}'); } },
    },
  });
  assert.equal(response.status, 404);
  assert.equal(assetFetches, 0);
  assert.equal((await response.json()).status, 'not-published');
});

test('attestation promotion requires both readiness and an R2 object', async () => {
  const sha = 'b'.repeat(64);
  const missing = await fetchRoute(`/api/attest/${sha}`, {
    env: { RELEASE_ATTESTATIONS_READY: 'true' },
  });
  assert.equal(missing.status, 503);

  const published = await fetchRoute(`/api/attest/${sha}`, {
    env: {
      RELEASE_ATTESTATIONS_READY: 'true',
      ATTESTATIONS: {
        get: async key => key === `${sha}.json`
          ? { size: 512, json: async () => signedAttestationDocument(sha) }
          : null,
      },
    },
  });
  assert.equal(published.status, 200);
  assert.equal(published.headers.get('X-One-Link-Attestation-Status'), 'published');
  assert.equal(published.headers.get('X-One-Link-Attestation-Signature'), 'present-unverified');
  assert.deepEqual(await published.json(), signedAttestationDocument(sha));
});

test('attestation publication rejects storage errors and unbound documents', async () => {
  const sha = 'c'.repeat(64);
  const storageError = await fetchRoute(`/api/attest/${sha}`, {
    env: {
      RELEASE_ATTESTATIONS_READY: 'true',
      ATTESTATIONS: { get: async () => { throw new Error('offline'); } },
    },
  });
  assert.equal(storageError.status, 503);
  assert.equal((await storageError.json()).status, 'storage-error');

  for (const object of [
    { size: 512, json: async () => signedAttestationDocument('d'.repeat(64)) },
    { size: 512, json: async () => ({ artifact: { sha256: sha }, signatures: [] }) },
    { size: 256 * 1024 + 1, json: async () => signedAttestationDocument(sha) },
    { size: 512, json: async () => { throw new SyntaxError('bad json'); } },
  ]) {
    const response = await fetchRoute(`/api/attest/${sha}`, {
      env: {
        RELEASE_ATTESTATIONS_READY: 'true',
        ATTESTATIONS: { get: async () => object },
      },
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, 'invalid-document');
  }
});

test('source metadata exposes only an unsigned R2 checksum and uses the exact release key', async () => {
  let requestedKey = null;
  const shaBytes = Uint8Array.from({ length: 32 }, () => 0xab).buffer;
  const object = {
    checksums: { sha256: shaBytes },
    customMetadata: {},
    get body() { throw new Error('metadata requests must not stream the archive'); },
  };
  const response = await fetchRoute('/download/source', {
    env: {
      RELEASES: {
        get: async key => {
          requestedKey = key;
          return object;
        },
      },
    },
    headers: { Accept: 'application/json', 'User-Agent': 'Windows NT 10.0' },
  });
  assert.equal(response.status, 200);
  assert.equal(requestedKey, 'latest/one-link-source.zip');
  const body = await response.json();
  assert.equal(body.integrity.sha256, 'ab'.repeat(32));
  assert.equal(body.integrity.signature, 'not-published');
  assert.equal(body.integrity.attestation, 'not-published');
  assert.match(body.note, /transport checksum.*no artifact signature/i);
});

test('source archive storage failures are explicit and retryable', async () => {
  const response = await fetchRoute('/download/source', {
    env: { RELEASES: { get: async () => { throw new Error('R2 offline'); } } },
    headers: { Accept: 'application/json' },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'source archive store request failed',
    status: 'storage-error',
    retryable: true,
  });
});

test('localized distribution pages share the fail-closed truth model', async () => {
  const prefixes = ['', 'es/', 'fr/', 'de/', 'pt/', 'it/'];
  for (const prefix of prefixes) {
    const home = await readFile(path.join(ROOT, 'dist', 'weareone-link.org', prefix, 'index.html'), 'utf8');
    const download = await readFile(path.join(ROOT, 'dist', 'weareone-link.org', prefix, 'download', 'index.html'), 'utf8');
    const verify = await readFile(path.join(ROOT, 'dist', 'weareone-link.org', prefix, 'verify-download', 'index.html'), 'utf8');
    const releases = await readFile(path.join(ROOT, 'dist', 'weareone-link.org', prefix, 'releases', 'index.html'), 'utf8');
    const builders = await readFile(path.join(ROOT, 'dist', 'weareone-link.org', prefix, 'builders', 'index.html'), 'utf8');

    assert.doesNotMatch(download, /href="\/download\/macos-x86_64/);
    assert.match(download, /macOS \(Intel\)[\s\S]*aria-disabled="true"|aria-disabled="true"[\s\S]*macOS \(Intel\)/);
    assert.doesNotMatch(download, /live signed value|signed, reproducibly built|all six mainstream desktop architectures/i);
    assert.match(verify, /id="ol-verify-file"/);
    assert.doesNotMatch(verify, /live signed value|bytes the maintainer signed/i);
    assert.match(releases, /auto-latest/);
    assert.doesNotMatch(releases, /Every binary is signed and reproducible|Every signed <span/i);
    assert.match(builders, /data-release-attestation="unavailable"[^>]*disabled/);
    assert.match(home, /id="ol-pair-qr"[^>]*role="img"[^>]*aria-label=/);
    for (const page of [home, download]) {
      assert.doesNotMatch(page, /<label for="nav-toggle"/);
      assert.match(page, /<button type="button" id="nav-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="primary-nav"/);
    }
  }

  const clHome = await readFile(path.join(ROOT, 'dist', 'weareone-link.org', 'index.cl.html'), 'utf8');
  assert.doesNotMatch(clHome, /<label for="nav-toggle"/);
  assert.match(clHome, /<button type="button" id="nav-toggle"[^>]*aria-expanded="false"[^>]*aria-controls="primary-nav"/);
  assert.match(clHome, /<nav class="site-nav" id="primary-nav"/);
});

test('update installation claims are disabled now and historical claims stay explicitly scoped', async () => {
  for (const locale of LOCALIZED_SURFACES) {
    const [howItWorks, changelog, features] = await Promise.all([
      localizedPage(locale, 'how-it-works'),
      localizedPage(locale, 'changelog'),
      localizedPage(locale, 'features'),
    ]);

    assertNone(
      howItWorks,
      OPERATIONAL_AUTOINSTALL_CLAIMS,
      `${locale.code}/how-it-works current auto-install capability`,
    );
    assertNone(
      features,
      OPERATIONAL_AUTOINSTALL_CLAIMS,
      `${locale.code}/features current auto-install capability`,
    );

    const historical = sectionsByClaimScope(changelog, 'historical-autoinstall-correction');
    assert.equal(
      historical.length,
      locale.code === 'en' ? 1 : 0,
      `${locale.code}/changelog historical auto-install correction count`,
    );
    let unscopedChangelog = changelog;
    for (const section of historical) {
      assert.match(section, /Historical note \(superseded\)/iu);
      assert.match(section, /Current correction/iu);
      assert.match(section, /disable automatic and in-place installation/iu);
      assert.match(section, /explicit user or operator action/iu);
      assert.match(section, OPERATIONAL_AUTOINSTALL_CLAIMS[0]);
      assert.match(section, OPERATIONAL_AUTOINSTALL_CLAIMS[1]);
      unscopedChangelog = unscopedChangelog.replace(section, '');
    }
    assertNone(
      unscopedChangelog,
      OPERATIONAL_AUTOINSTALL_CLAIMS,
      `${locale.code}/changelog unscoped auto-install capability`,
    );

    const currentBoundary = sectionsByClaimScope(howItWorks, 'updater-install-boundary');
    assert.equal(
      currentBoundary.length,
      locale.code === 'en' ? 1 : 0,
      `${locale.code}/how-it-works frozen updater boundary count`,
    );
    for (const section of currentBoundary) {
      assert.match(section, /Frozen desktop bundles disable automatic and in-place installation/iu);
      assert.match(section, /no automatic, silent, or in-place install path/iu);
      assert.match(section, /explicit user or operator action/iu);
      assert.match(section, /does not prove who produced the bytes/iu);
    }
    if (locale.code === 'en') {
      assert.match(features, /Automatic and in-place installation is unavailable/iu);
      assert.match(features, /explicit user or operator action/iu);
    }
  }
});

test('all locales keep platform, encryption, presence, and physics claims within proven scope', async () => {
  const expectations = {
    en: {
      encryption: 'End-to-end encryption on supported, versioned paths.',
      presence: 'Non-authoritative website sessions visible now',
      quantum: 'it cannot transmit usable information faster than light',
      physicsScope: 'are metaphors here, not evidence for a proven "unified field."',
    },
    es: {
      encryption: 'Cifrado de extremo a extremo en rutas compatibles y versionadas.',
      presence: 'Sesiones del sitio web visibles ahora; identidades no verificadas',
      quantum: 'no permite transmitir información utilizable más rápido que la luz',
      physicsScope: 'son metáforas, no pruebas de un «campo unificado» demostrado.',
    },
    fr: {
      encryption: 'Chiffrement de bout en bout sur les parcours pris en charge et versionnés.',
      presence: 'Sessions du site visibles actuellement, sans identité vérifiée',
      quantum: 'ne permet pas de transmettre une information exploitable plus vite que la lumière',
      physicsScope: 'sont ici des métaphores, et non la preuve d\'un « champ unifié » démontré.',
    },
    de: {
      encryption: 'Ende-zu-Ende-Verschlüsselung auf unterstützten, versionierten Pfaden.',
      presence: 'Derzeit sichtbare Website-Sitzungen; Identitäten nicht verifiziert',
      quantum: 'keine nutzbare Informationsübertragung schneller als Licht',
      physicsScope: 'sind hier Metaphern und kein Beleg für ein nachgewiesenes „vereinheitlichtes Feld“.',
    },
    pt: {
      encryption: 'Criptografia de ponta a ponta em percursos suportados e versionados.',
      presence: 'Sessões do site visíveis agora; identidades não verificadas',
      quantum: 'não permite transmitir informação utilizável mais depressa do que a luz',
      physicsScope: 'são aqui metáforas, não provas de um «campo unificado» demonstrado.',
    },
    it: {
      encryption: 'Crittografia end-to-end sui percorsi supportati e versionati.',
      presence: 'Sessioni del sito visibili ora; identità non verificate',
      quantum: 'non consente di trasmettere informazioni utilizzabili più velocemente della luce',
      physicsScope: 'sono metafore, non prove di un «campo unificato» dimostrato.',
    },
  };
  const stalePhysics = /(?:particles?|partículas|particules|Teilchen|partículas|particelle).{0,80}(?:influence|influyen|s'influencent|beeinflussen|influenciam|influenzano).{0,40}(?:instant|istant|augenblick)/iu;

  for (const locale of LOCALIZED_SURFACES) {
    const expected = expectations[locale.code];
    const [home, mesh, one] = await Promise.all([
      localizedPage(locale, 'index'),
      localizedPage(locale, 'mesh'),
      localizedPage(locale, 'one'),
    ]);
    const operatingSystem = home.match(/"operatingSystem"\s*:\s*"([^"]+)"/u);

    assert.ok(operatingSystem, `${locale.code}/home must publish SoftwareApplication operatingSystem`);
    assert.equal(operatingSystem[1], 'Windows, macOS, Linux', `${locale.code}/home must advertise only published desktop platforms`);
    assert.ok(home.includes(expected.encryption), `${locale.code}/home must scope E2EE to supported, versioned paths`);
    assert.ok(home.includes(`aria-label="${expected.presence}"`), `${locale.code}/home must label website sessions non-authoritatively`);
    assert.ok(mesh.includes(`aria-label="${expected.presence}"`), `${locale.code}/mesh must label website sessions non-authoritatively`);
    assert.ok(one.includes(expected.quantum), `${locale.code}/one must state the quantum no-signalling limit`);
    assert.ok(one.includes(expected.physicsScope), `${locale.code}/one must label broader interconnection language as metaphor`);
    assert.doesNotMatch(one, stalePhysics, `${locale.code}/one must not claim instantaneous causal influence`);
  }
});

test('all locales scope capability, metadata, and share claims to what is actually implemented', async () => {
  for (const locale of LOCALIZED_SURFACES) {
    const label = locale.code;
    const [home, features, howItWorks, share, mesh, privacy, security] = await Promise.all([
      localizedPage(locale, 'index'),
      localizedPage(locale, 'features'),
      localizedPage(locale, 'how-it-works'),
      localizedPage(locale, 'share'),
      localizedPage(locale, 'mesh'),
      localizedPage(locale, 'privacy'),
      localizedPage(locale, 'security'),
    ]);

    assertNone(features, RISKY_COPY.capability, `${label}/features capability source`);
    assert.doesNotMatch(
      features,
      /<h3>(?:Files of any size|Archivos de cualquier tamaño|Fichiers de toute taille|Dateien jeder Größe|Ficheiros de qualquer tamanho|File di qualsiasi dimensione|End-to-end encrypted by default\.|Cifrado de extremo a extremo por defecto\.|Chiffré de bout en bout par défaut\.|Standardmäßig Ende-zu-Ende-verschlüsselt\.|Cifrado de ponta a ponta por defeito\.|Cifrato end-to-end per default\.|No central server in the path\.|Sin servidor central en el camino\.|Pas de serveur central sur le chemin\.|Kein zentraler Server im Pfad\.|Sem servidor central no caminho\.|Nessun server centrale nel percorso\.|Post-quantum hybrid keys \+ signatures\.|Claves y firmas híbridas postcuánticas\.|Clés et signatures hybrides post-quantiques\.|Post-Quanten-hybride Schlüssel und Signaturen\.|Chaves e assinaturas híbridas pós-quânticas\.|Chiavi e firme ibride post-quantistiche\.)<\/h3>/iu,
      `${label}/features must not retain absolute legacy headings`,
    );
    assert.match(features, /\/api\/capabilities/iu, `${label}/features must name the real Worker endpoint`);
    assert.match(features, TRUTH_WORDS.staticScope, `${label}/features must say the capability view is static/build-scoped`);

    const metadata = [home, features, howItWorks, share, mesh, privacy, security]
      .map(descriptionMetadata)
      .join('\n');
    assertNone(metadata, RISKY_COPY.metadata, `${label} description metadata`);
    const homeMetadata = descriptionMetadata(home);
    assert.match(homeMetadata, TRUTH_WORDS.prerelease, `${label} homepage metadata must identify prerelease status`);
    assert.match(homeMetadata, TRUTH_WORDS.relay, `${label} homepage metadata must disclose relay fallback`);
    assert.doesNotMatch(
      home,
      /aria-label="(?:Send anything\. To anyone|Envía cualquier cosa\. A cualquiera|Envoyez n’importe quoi\. À n’importe qui|Alles senden\. An jeden|Envie qualquer coisa\. A qualquer pessoa|Invia qualsiasi cosa\. A chiunque)/iu,
      `${label} homepage must not imply unlimited content or universal recipients`,
    );
    assert.doesNotMatch(
      home,
      /(?:Join the network|Únete a la red|Rejoindre le réseau|Dem Netzwerk beitreten|Entrar na rede|Unisciti alla rete)/iu,
      `${label} homepage download CTA must not imply proven production-mesh admission`,
    );

    assertNone(share, RISKY_COPY.share, `${label}/share limits`);
    assert.match(share, /25\s*(?:MB|Mo)\b/iu, `${label}/share must publish its current size cap`);
    assert.match(share, /24(?:\s+|-)(?:hours?|horas?|heures?|stunden|ore)\b/iu, `${label}/share must publish ciphertext retention`);
    assert.match(share, /Cloudflare\s+R2/iu, `${label}/share must identify the ciphertext store`);
    assert.match(share, /ciphertext|texto cifrado|chiffr[ée]|chiffretext|testo cifrato/iu, `${label}/share must distinguish ciphertext from plaintext`);
  }
});

test('all locales describe mesh presence, privacy processing, and browser session limits without anonymity absolutes', async () => {
  const meshScope = /(?:not|does not|no|ne.{0,20}pas|kein|nicht|non|n[aã]o).{0,100}(?:daemon|routing|enrutamiento|routage|knoten|node|nodo|n[œo]ud|encaminhamento|n[oó])/iu;
  const sessionLimit = /pending|pendiente|en attente|ausstehend|in attesa|pendente|not.{0,40}(?:established|secure|protected)|no.{0,40}(?:establece|segura|protegida)|n.est pas.{0,40}(?:[ée]tablie|prot[ée]g[ée]e)|nicht.{0,40}(?:aufgebaut|gesichert)|non.{0,40}(?:stabilisce|sicura|protetta)|n[aã]o.{0,40}(?:estabelece|segura|protegida)/iu;
  const stateDisclosure = /session|sesi[oó]n|sess[aã]o|sitzung|sessione|subnet|subred|sous-r[ée]seau|subnetz|sottorete|sub-rede/iu;

  for (const locale of LOCALIZED_SURFACES) {
    const label = locale.code;
    const [home, mesh, privacy, security, howItWorks] = await Promise.all([
      localizedPage(locale, ''),
      localizedPage(locale, 'mesh'),
      localizedPage(locale, 'privacy'),
      localizedPage(locale, 'security'),
      localizedPage(locale, 'how-it-works'),
    ]);

    assertNone(mesh, RISKY_COPY.mesh, `${label}/mesh identity and topology`);
    assertNone(titleMetadata(mesh), RISKY_COPY.titleMetadata, `${label}/mesh title metadata`);
    assert.match(titleMetadata(mesh), TRUTH_WORDS.presence, `${label}/mesh titles must identify website presence`);
    assert.match(mesh, TRUTH_WORDS.presence, `${label}/mesh must identify presence data`);
    assert.match(mesh, TRUTH_WORDS.visitor, `${label}/mesh must identify dots as website visitors`);
    assert.match(mesh, meshScope, `${label}/mesh must deny that the visualization is live daemon routing telemetry`);
    assert.doesNotMatch(mesh, /id="(?:ol-hero-count|ol-mesh-nodes)"[^>]*>0</u, `${label}/mesh must not claim zero before presence is validated`);
    assert.doesNotMatch(home, /id="ol-node-count"[^>]*>1</u, `${label}/home must not claim one live visitor before presence is validated`);

    assertNone(privacy, RISKY_COPY.privacy, `${label}/privacy absolutes`);
    assertNone(titleMetadata(privacy), RISKY_COPY.titleMetadata, `${label}/privacy title metadata`);
    assert.match(titleMetadata(privacy), /data|datos|donn[ée]es|Daten|dados|dati/iu, `${label}/privacy title must describe data processing`);
    assert.match(privacy, /Cloudflare/iu, `${label}/privacy must disclose the edge provider`);
    assert.match(privacy, /metadata|metadatos|m[ée]tadonn[ée]es|metadaten|metadati|metadados/iu, `${label}/privacy must disclose network/request metadata`);
    assert.match(privacy, stateDisclosure, `${label}/privacy must disclose ephemeral or rate-limit state`);

    assertNone(security, RISKY_COPY.security, `${label}/security absolutes`);
    assert.match(security, /\/api\/session/iu, `${label}/security must scope the browser session endpoint`);
    assert.match(security, /X25519/iu, `${label}/security must state the advertised classical key`);
    assert.match(security, /ML-KEM-768/iu, `${label}/security must state the pending PQ half`);
    assert.match(security, sessionLimit, `${label}/security must say no browser-to-Worker secure/PQ session is established`);

    assertNone(howItWorks, RISKY_COPY.mesh, `${label}/how-it-works anonymity`);
    assertNone(howItWorks, RISKY_COPY.security, `${label}/how-it-works PQ scope`);
  }
});

test('all security disclosures separate current capacity, non-guaranteed targets, and legal boundaries', async () => {
  const bestEffort = /best[- ]effort|mejor esfuerzo|mieux des possibilit[ée]s|bestem Bem[üu]hen|melhor esfor[cç]o|limiti del possibile/iu;
  const nonGuarantee = /not guaranteed|no (?:se )?garant|non garant|nicht garantiert|n[aã]o (?:se )?garant|no guaranteed|aucun.{0,24}garanti|keine.{0,24}garant/iu;
  const noAuthenticatedShare = /not an authenticated security-report channel|no un canal autenticado para informes de seguridad|pas un canal authentifi[ée] de signalement de s[ée]curit[ée]|kein authentifizierter Kanal f[üu]r Sicherheitsmeldungen|n[aã]o um canal autenticado para reportes de seguran[cç]a|non un canale autenticato per segnalazioni di sicurezza/iu;
  const noCveGuarantee = /cannot assign or guarantee a CVE|no puede asignar ni garantizar un CVE|ne peut ni attribuer ni garantir un CVE|kann keine CVE zuweisen oder garantieren|n[aã]o pode atribuir nem garantir um CVE|non pu[oò] assegnare n[ée] garantire un CVE/iu;
  const thirdPartyControl = /controlled by those third parties|terceras partes controlan|ces tiers contr[oô]lent|kontrollieren diese Dritten|entidades terceiras controlam|controllate da tali terze parti/iu;
  const noRewardPromise = /no promise of payment|ni se promete pago|aucune promesse de paiement|kein Versprechen auf Zahlung|nem promessa de pagamento|non vi [èe] promessa di pagamento/iu;
  const legalBoundary = /not a legal guarantee|no es una garant[ií]a legal|aucune garantie juridique|keine Rechtsgarantie|n[aã]o [ée] uma garantia jur[ií]dica|non [èe] una garanzia legale/iu;
  const cannotBind = /cannot bind hosting providers|no pueden vincular a proveedores de alojamiento|ne peuvent engager les h[ée]bergeurs|k[oö]nnen Hostinganbieter.{0,90}nicht binden|n[aã]o podem vincular fornecedores de alojamento|non possono vincolare provider di hosting/iu;
  const writtenAuthorization = /written authorization|autorizaci[oó]n escrita|autorisation [ée]crite|schriftliche Genehmigung|autoriza[cç][aã]o escrita|autorizzazione scritta/iu;
  const futureTarget = /remains (?:a|the) target|sigue siendo (?:un|el) objetivo|reste (?:un |l.)objectif|bleibt (?:ein|das) Ziel|continua a ser (?:um|o) objetivo|resta (?:un |l.)obiettivo/iu;

  for (const locale of LOCALIZED_SURFACES) {
    const label = locale.code;
    const security = await localizedPage(locale, 'security');
    assertNone(security, RISKY_COPY.disclosure, `${label}/security disclosure promises`);
    assert.equal(
      (security.match(/data-claim-scope="security-disclosure"/gu) ?? []).length,
      1,
      `${label}/security must have one generated disclosure section`,
    );
    assert.match(security, bestEffort, `${label}/security must disclose best-effort staffing`);
    assert.match(security, /24|rund um die Uhr/iu, `${label}/security must deny a staffed 24/7 operation`);
    assert.match(security, nonGuarantee, `${label}/security must deny guaranteed disclosure outcomes`);

    const contact = uniqueArticleByClaimId(security, 'security-contact', `${label}/security contact`);
    assert.match(contact, /weareone@oneunity\.earth/iu);
    assert.match(contact, /\/\.well-known\/security\.txt/iu);
    assert.match(contact, /\/share\//iu);
    assert.match(contact, noAuthenticatedShare, `${label}/security must not market /share/ as authenticated intake`);

    const response = uniqueArticleByClaimId(security, 'security-response', `${label}/security response`);
    assert.match(response, /SLA/iu);
    assert.match(response, nonGuarantee, `${label}/security response targets must be non-guaranteed`);
    assert.match(response, /72/iu);
    assert.match(response, /7/iu);
    assert.match(response, /30.{0,12}90/iu);

    const bounty = uniqueArticleByClaimId(security, 'security-bounty-cve', `${label}/security bounty and CVE`);
    assert.match(bounty, /CNA/iu);
    assert.match(bounty, /CVE/iu);
    assert.match(bounty, noCveGuarantee, `${label}/security must not promise CVE assignment`);
    assert.match(bounty, thirdPartyControl, `${label}/security must identify third-party CVE control`);
    assert.match(bounty, noRewardPromise, `${label}/security must not promise bounty consideration`);
    assert.match(bounty, futureTarget, `${label}/security must retain the funded-program target conditionally`);

    const severity = uniqueArticleByClaimId(security, 'security-severity', `${label}/security severity`);
    assert.match(severity, /SLA/iu);
    assert.match(severity, /CVE/iu);

    const safeHarbor = uniqueArticleByClaimId(security, 'security-safe-harbor', `${label}/security safe harbor`);
    assert.match(safeHarbor, legalBoundary, `${label}/security must deny a legal safe-harbor guarantee`);
    assert.match(safeHarbor, cannotBind, `${label}/security must name parties contributors cannot bind`);
    assert.match(safeHarbor, writtenAuthorization, `${label}/security must direct uncertain research to written authorization`);
    assert.match(safeHarbor, futureTarget, `${label}/security must retain a formal safe-harbor target`);

    const track = uniqueArticleByClaimId(security, 'security-track-record', `${label}/security track record`);
    assert.match(track, /independent|independiente|ind[ée]pendant|unabh[aä]ngig|independente|indipendente/iu);
    assert.match(track, /not guaranteed|no garantiza|n.est pas garantie|nicht garantiert|n[aã]o [ée] garantidamente|non [èe] garantito/iu);
  }

  const [securityText, securityPolicy] = await Promise.all([
    readFile(path.join(ROOT, 'dist', 'weareone-link.org', '.well-known', 'security.txt'), 'utf8'),
    readFile(path.join(ROOT, 'SECURITY.md'), 'utf8'),
  ]);
  assertNone(securityText, RISKY_COPY.disclosure, 'security.txt disclosure promises');
  assert.match(securityText, /best-effort inbox/iu);
  assert.match(securityText, /not an SLA/iu);
  assert.match(securityText, /does not claim CNA status/iu);
  assert.match(securityText, /no funded bug-bounty program/iu);
  assert.match(securityText, /not a legal guarantee/iu);
  const securityTextExpiry = securityText.match(/^Expires:\s*(\S+)\s*$/imu)?.[1];
  assert.ok(securityTextExpiry, 'security.txt must publish an RFC 9116 expiry');
  const expiryTime = Date.parse(securityTextExpiry);
  assert.ok(Number.isFinite(expiryTime), 'security.txt expiry must be parseable');
  assert.ok(expiryTime > Date.now(), 'security.txt must not be expired');
  assert.ok(expiryTime - Date.now() <= 366 * 86_400_000, 'security.txt expiry must stay within one year');
  assertNone(securityPolicy, RISKY_COPY.disclosure, 'SECURITY.md disclosure promises');
  assert.match(securityPolicy, /no response-time SLA/iu);
  assert.match(securityPolicy, /not a legal safe-harbor guarantee/iu);
  assert.match(securityPolicy, /cannot bind/iu);
});

test('all locales bind Builders cards and roadmap targets to audited implementation boundaries', async () => {
  const roadmapClaims = [
    'roadmap-silent-loss',
    'roadmap-remote-pair',
    'roadmap-timing-analysis',
    'roadmap-hardware-keys',
    'roadmap-telemetry',
  ];
  const targetLanguage = /Target|Objetivo|Objectif|Ziel|Obiettivo/iu;
  const threatModelLanguage = /Threat model|Modelo de amenazas?|Mod[èe]le de menace|Bedrohungsmodell|Modelo de amea[cç]a|Modello di minaccia/iu;
  const acceptanceEvidence = /tests?|pruebas?|testes?|preuves?|Nachweis|evidencia|evidence|provino|provem|provare/iu;

  for (const locale of LOCALIZED_SURFACES) {
    const label = locale.code;
    const [builders, roadmap] = await Promise.all([
      localizedPage(locale, 'builders'),
      localizedPage(locale, 'roadmap'),
    ]);

    assertNone(builders, RISKY_COPY.builders, `${label}/builders stale crate claims`);
    const transfer = uniqueArticleByHeading(builders, 'ol_transfer', `${label}/builders ol_transfer`);
    assert.match(transfer, /QUIC/iu);
    assert.match(transfer, /ChunkRecord/iu);
    assert.match(transfer, /Bloom/iu);
    assert.match(transfer, /fountain|fontaine/iu);

    const recovery = uniqueArticleByHeading(builders, 'ol_threshold_recovery', `${label}/builders ol_threshold_recovery`);
    assert.match(recovery, /Shamir/iu);
    assert.match(recovery, /GF\(2\^8\)/u);
    assert.match(recovery, /does not implement|no implementa|n.impl[ée]mente|implementiert weder|n[aã]o implementa|non implementa/iu);

    const confidential = uniqueArticleByHeading(builders, 'ol_confidential', `${label}/builders ol_confidential`);
    assert.match(confidential, /ChaCha20-Poly1305/u);
    assert.match(confidential, /Windows[- ]TPM/iu);
    assert.match(confidential, /not implemented|no est[aá]n implementados|ne sont pas impl[ée]ment[ée]s|nicht implementiert|n[aã]o est[aã]o implementados|non sono implementati/iu);

    const routing = uniqueArticleByHeading(builders, 'ol_routing', `${label}/builders ol_routing`);
    assert.match(routing, /Dijkstra/u);
    assert.match(routing, /RTT/u);
    assert.match(routing, /not evidence|no demuestra|ne prouve|belegt nicht|n[aã]o prova|non prova/iu);

    const duress = uniqueArticleByHeading(builders, 'ol_duress', `${label}/builders ol_duress`);
    assert.match(duress, /DuressGate/u);
    assert.match(duress, /not a filesystem|no son un sistema de archivos|ni un syst[èe]me de fichiers|weder Dateisystem|n[aã]o s[aã]o um sistema de ficheiros|non sono un filesystem/iu);

    assertNone(roadmap, RISKY_COPY.roadmap, `${label}/roadmap security absolutes`);
    for (const claimId of roadmapClaims) {
      const card = uniqueArticleByClaimId(roadmap, claimId, `${label}/${claimId}`);
      assert.match(card, targetLanguage, `${label}/${claimId} must remain a target`);
      assert.match(card, threatModelLanguage, `${label}/${claimId} must state its threat model`);
      assert.match(card, acceptanceEvidence, `${label}/${claimId} must require test evidence`);
    }
  }
});

test('all locales fail closed on infrastructure, pairing, status, terms, and 404 marketing claims', async () => {
  const artifactSignatureUnavailable = /signature.{0,50}(?:not published|unavailable)|no se publican.{0,40}firmas?|aucune signature.{0,50}publi[ée]e|signatur.{0,50}nicht ver[oö]ffentlicht|firme?.{0,50}non.{0,20}pubblicat|assinaturas?.{0,50}n[aã]o.{0,20}publicad/iu;
  const rollingOrPreview = /rolling|continuous|continu|kontinuier|continuo|cont[ií]nuo|pre[- ]?release|prerelease|preview|vorab|preliminar|pr[ée]version|anteprima|pr[ée]via/iu;
  const operatedService = /services?|servicios?|services?|dienste|servizi|servi[cç]os|relay|rel[eé]|relais|rendezvous|discovery|descubrimiento|d[ée]couverte|erkennung|scoperta|descoberta/iu;

  for (const locale of LOCALIZED_SURFACES) {
    const label = locale.code;
    const [transparency, accessibility, terms, notFound, roadmap, features] = await Promise.all([
      localizedPage(locale, 'transparency'),
      localizedPage(locale, 'accessibility'),
      localizedPage(locale, 'terms'),
      localizedPage(locale, '404'),
      localizedPage(locale, 'roadmap'),
      localizedPage(locale, 'features'),
    ]);

    assertNone(transparency, [...RISKY_COPY.infrastructure, ...RISKY_COPY.privacy, ...RISKY_COPY.mesh], `${label}/transparency`);
    assert.match(transparency, /Cloudflare/iu, `${label}/transparency must identify hosting dependence`);
    assert.match(transparency, TRUTH_WORDS.dependency, `${label}/transparency must state current infrastructure dependencies`);
    assert.match(transparency, TRUTH_WORDS.metadata, `${label}/transparency must disclose metadata processing`);
    assertRecentOrMarkedStale(transparency, `${label}/transparency`);
    assertFutureRefreshOrMarkedStale(transparency, `${label}/transparency`);

    assertNone(accessibility, RISKY_COPY.accessibility, `${label}/accessibility`);
    assert.match(accessibility, TRUTH_WORDS.selfTest, `${label}/accessibility must call browser pairing a self-test`);
    assert.match(accessibility, TRUTH_WORDS.secondDevice, `${label}/accessibility must distinguish real two-device pairing`);
    assertRecentOrMarkedStale(accessibility, `${label}/accessibility`);

    assertNone(terms, RISKY_COPY.infrastructure, `${label}/terms continuity`);
    assert.match(terms, TRUTH_WORDS.dependency, `${label}/terms must scope present operational dependencies`);
    assert.match(terms, operatedService, `${label}/terms must name the operated services/relays`);

    assertNone(notFound, [...RISKY_COPY.signed404, ...RISKY_COPY.security, ...RISKY_COPY.metadata], `${label}/404`);
    assert.match(notFound, rollingOrPreview, `${label}/404 must label artifacts as rolling/test/prerelease`);
    assert.match(notFound, artifactSignatureUnavailable, `${label}/404 must state that artifact signatures are unavailable`);

    assertRecentOrMarkedStale(features, `${label}/features`);
    assertRecentOrMarkedStale(roadmap, `${label}/roadmap`);
  }
});

test('RSS dates have truthful weekdays and the feed is current or explicitly archived prerelease history', async () => {
  const feed = await readFile(path.join(ROOT, 'dist', 'weareone-link.org', 'feed.xml'), 'utf8');
  assert.match(feed, /pre[- ]?release|prerelease|preview/i);
  assert.doesNotMatch(feed, /<title>\s*One Link is live\s*<\/title>/iu);

  const buildValue = feed.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/u)?.[1];
  assert.ok(buildValue, 'feed must publish lastBuildDate');
  const buildDate = assertRfcWeekday(buildValue, 'lastBuildDate');

  const publicationValues = [...feed.matchAll(/<pubDate>([^<]+)<\/pubDate>/gu)].map(match => match[1]);
  assert.ok(publicationValues.length > 0, 'feed must contain at least one dated item');
  for (const [index, value] of publicationValues.entries()) {
    const publication = assertRfcWeekday(value, `pubDate[${index}]`);
    assert.ok(buildDate >= publication, 'lastBuildDate cannot precede an item publication');
  }

  const ageDays = (Date.now() - buildDate.valueOf()) / 86_400_000;
  const archived = /archived|archive|historical feed|feed hist[oó]rico/i.test(feed);
  assert.ok(archived || ageDays <= 45, `active feed is stale by ${Math.floor(ageDays)} days; refresh it or label it archived`);
});

test('browser verifier distinguishes local hashes, checksums, and signatures', async () => {
  const bridge = await readFile(path.join(ROOT, 'dist', 'weareone-link.org', 'live', 'bridge.js'), 'utf8');
  assert.match(bridge, /NOT VERIFIED/);
  assert.match(bridge, /CHECKSUM MATCH ONLY/);
  assert.match(bridge, /AUTHENTICATED MATCH/);
  assert.match(bridge, /signatureVerified = integrity\.signature === 'verified'/);
  assert.match(bridge, /const ATTESTATION_TARGET_SHA = null/);
  assert.match(bridge, /const cssWidth = window\.innerWidth;\s+const cssHeight = window\.innerHeight;/);
  assert.match(bridge, /window\.addEventListener\('resize', scheduleResize, \{ passive: true \}\)/);
  assert.doesNotMatch(bridge, /This is byte-for-byte the binary we signed/);
});

test('presence and chat UI fail closed until a validated Worker welcome', async () => {
  const [bridge, worker] = await Promise.all([
    readFile(path.join(ROOT, 'dist', 'weareone-link.org', 'live', 'bridge.js'), 'utf8'),
    readFile(path.join(ROOT, 'src', 'worker.js'), 'utf8'),
  ]);

  assert.doesNotMatch(bridge, /Start anonymous chat|Anonymous stranger chat|ephemeral\s*&middot;\s*anonymous/iu);
  assert.doesNotMatch(bridge, /setPresenceCount\(1\)|['"]local-['"]\s*\+/u);
  assert.match(bridge, /validPresenceId\(msg\.self_id\)\s*\|\|\s*!validPopulation\(msg\.population\)/u);
  assert.match(bridge, /if \(!presence\.validated \|\| !Array\.isArray\(msg\.peers\)\) break/u);
  assert.match(bridge, /presence\.welcomeTimer = setTimeout/u);
  assert.match(bridge, /type: 'heartbeat'/u);
  assert.match(bridge, /Cloudflare relays ciphertext and sees metadata/iu);
  assert.match(bridge, /Cloudflare still receives\s+ordinary connection metadata/iu);
  assert.match(bridge, /(?:the )?peer can retain messages/iu);
  assert.match(bridge, /typing unlocks only after both sides report comparing all five SAS words/iu);
  assert.match(bridge, /sealChatPayload\(chat\.active\.key, \{ type: 'sas-confirmed' \}\)/u);
  assert.doesNotMatch(worker, /case "chat-sas-confirmed"/u);

  assert.doesNotMatch(worker, /Zero PII|No IPs, no Cookies, no headers logged/iu);
  assert.match(worker, /Cloudflare receives the connection IP and other edge metadata/iu);
});

test('repository truth documents track the hardened share lifecycle and rate-key minimization', async () => {
  const [readme, matrix, workerSource] = await Promise.all([
    readFile(path.join(ROOT, 'README.md'), 'utf8'),
    readFile(path.join(ROOT, 'docs', 'CLAIM_CAPABILITY_GAP_MATRIX.md'), 'utf8'),
    readFile(path.join(ROOT, 'src', 'worker.js'), 'utf8'),
  ]);

  assert.doesNotMatch(readme, /retrieval and deletion are best-effort, not atomic/iu);
  assert.doesNotMatch(readme, /Worker has no background cleanup job/iu);
  assert.match(readme, /serialized single-consumer claim/iu);
  assert.match(readme, /R2 delete to acknowledge/iu);
  assert.match(matrix, /Encrypted temporary web sharing with serialized first retrieval/iu);
  assert.match(matrix, /per-object Durable Object,? which serializes claims/iu);
  assert.doesNotMatch(matrix, /concurrent GETs are not atomically consumed/iu);
  assert.doesNotMatch(matrix, /falls back to the full raw string/iu);
  assert.match(matrix, /collapses malformed input into one non-identifying bucket/iu);
  assert.match(matrix, /deletes idle durable rate state by a seven-day alarm/iu);
  assert.match(workerSource, /content-length required/iu);
  assert.match(workerSource, /body: request\.body/iu);
  assert.match(workerSource, /a full address is never used as a DO name/iu);
});

test('every localized share file picker has an accessible name', async () => {
  for (const locale of LOCALIZED_SURFACES) {
    const share = await localizedPage(locale, 'share');
    assert.match(
      share,
      /<input\s+type="file"\s+id="ol-share-file"\s+aria-label="[^"]+"\s+hidden>/iu,
      `${locale.code}/share file input`,
    );
  }
});
