#!/usr/bin/env python3
"""Render the public distribution surfaces from one fail-closed truth model.

The rolling GitHub artifacts are useful alpha builds, but they are not an
immutable, signed, attested, or reproducibly verified release.  This script
keeps that distinction identical across every localized download, verification,
release, and builder page.  It is intentionally idempotent and supports a
``--check`` mode for CI.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist" / "weareone-link.org"
LOCALE_PATHS = {"en": "", "es": "es", "fr": "fr", "de": "de", "pt": "pt", "it": "it"}


COPY = {
    "en": {
        "download_title": "Download current builds - One Link",
        "download_desc": "Current One Link desktop alpha builds, exact platform availability, and honest verification status.",
        "download_kicker": "Current build channel",
        "download_h1": "Download with the proof state visible.",
        "download_lede": "The desktop artifacts below are mutable continuous alpha builds from GitHub's auto-latest channel. They are not an immutable versioned release. Every artifact carries a GitHub build-provenance attestation, checkable with gh attestation verify, which proves the file came from this project's publishing workflow rather than a third party. Artifact signatures, publisher code signing, and reproducible-build evidence are not published.",
        "choose": "Choose the exact platform",
        "rolling": "continuous alpha build",
        "unavailable": "not published",
        "source_status": "source archive, when available",
        "availability": "Windows on Intel/AMD and ARM, macOS on Apple Silicon, and Linux on Intel/AMD and ARM have rolling artifacts. No macOS Intel artifact is published. Android and iOS binaries are not published.",
        "proof_h": "What you can verify today",
        "hash_h": "Local hash",
        "hash_p": "The browser can compute SHA-256 over your file without uploading it. That identifies the bytes you hold, but it is not proof of who produced them.",
        "sig_h": "Artifact signature",
        "sig_p": "No One Link release signature, Windows Authenticode signature, or Apple Developer ID notarization is published for the rolling builds.",
        "repro_h": "Reproducibility and provenance",
        "repro_p": "No byte-for-byte reproducibility result is published for the rolling builds. Every artifact does carry a GitHub build-provenance attestation, verifiable with gh attestation verify against this repository: it binds those exact bytes to the publishing workflow that emitted them, so nobody else's upload can pass as ours. It is not a One Link signed artifact-bound attestation document, and it does not let you rebuild the bytes and compare.",
        "warning": "Treat these artifacts as pre-release test builds. Do not bypass operating-system warnings on the assumption that this website verified a signature.",
        "verify_cta": "Compute a local SHA-256",
        "github_cta": "Inspect GitHub artifacts",
        "verify_title": "Hash a download locally - One Link",
        "verify_desc": "Compute a One Link artifact SHA-256 locally and see whether an authenticated reference is actually available.",
        "verify_kicker": "Local checksum tool",
        "verify_h1": "Hash the file in your browser.",
        "verify_lede": "Your browser computes SHA-256 locally. The file never leaves your device. The result is only an authenticated verification when a separate, artifact-bound signed reference is available. The current rolling channel does not publish one.",
        "drop_head": "Drop your file here, or click to choose.",
        "drop_sub": "The file stays in this tab. No upload occurs.",
        "verify_explain_h": "Read the verdict literally",
        "verify_p1": "A local SHA-256 is useful for identifying a file and checking transfer corruption.",
        "verify_p2": "If no reference hash is published, the tool reports NOT VERIFIED. It will not imply that a signature or attestation was checked.",
        "verify_p3": "Even an unsigned checksum match does not prove authorship. A future authenticated verdict requires a version-pinned artifact, a signed checksum manifest, and a verified release signature.",
        "release_title": "Release status - One Link",
        "release_desc": "The current One Link artifact channel and the exact evidence required before an immutable release is promoted.",
        "release_kicker": "Release status",
        "release_h1": "Continuous builds are not immutable releases.",
        "release_lede": "auto-latest is a mutable prerelease channel. Its artifacts are useful for testing and each one carries a GitHub build-provenance attestation, but the channel can change in place and still publishes no artifact signature, code-signing proof, or reproducibility result.",
        "current_h": "Available now",
        "current_p": "Supported desktop artifacts remain downloadable from GitHub and are labelled continuous alpha builds. The website does not present them as signed production releases.",
        "ready_h": "Promotion gate for a versioned release",
        "ready_items": [
            "An explicit immutable version and source commit.",
            "Exact per-platform asset names and SHA-256 values in a signed manifest.",
            "Publisher code signing where the operating system supports it.",
            "Artifact-bound provenance, SBOM, and attestation documents.",
            "Reproducibility evidence from an independent rebuild, not intent alone.",
        ],
        "release_note": "Until every applicable gate is present, public routes stay on the clearly labelled rolling channel. Setting VERSIONED_RELEASE_TAG later pins the same routes to one explicit v* tag without changing their URLs.",
        "downloads_cta": "View current builds",
        "releases_cta": "Inspect GitHub releases",
        "builder_kicker": "Release proof unavailable",
        "builder_h": "Source can be inspected, but this release is not attested.",
        "builder_p": "The current rolling source archive has no published artifact-bound signature or reproducible-build attestation. You can clone and build the source, and you can compute a local hash, but this page will not present either action as release verification.",
        "builder_button": "Source attestation not published",
    },
    "es": {
        "download_title": "Descargar compilaciones actuales - One Link",
        "download_desc": "Compilaciones alfa actuales de One Link, disponibilidad exacta y estado real de verificación.",
        "download_kicker": "Canal de compilación actual",
        "download_h1": "Descarga con el estado de prueba visible.",
        "download_lede": "Los artefactos de escritorio son compilaciones alfa continuas y mutables del canal auto-latest de GitHub. No son una versión inmutable. Cada artefacto incluye una atestación de procedencia de compilación de GitHub, comprobable con gh attestation verify, que demuestra que el archivo salió del flujo de publicación de este proyecto y no de un tercero. No se publican firmas de artefacto, firma del editor ni pruebas de compilación reproducible.",
        "choose": "Elige la plataforma exacta",
        "rolling": "compilación alfa continua",
        "unavailable": "no publicado",
        "source_status": "archivo fuente, si está disponible",
        "availability": "Hay artefactos continuos para Windows Intel/AMD y ARM, macOS Apple Silicon y Linux Intel/AMD y ARM. No hay artefacto para macOS Intel. Android e iOS no están publicados.",
        "proof_h": "Qué puedes verificar hoy",
        "hash_h": "Hash local",
        "hash_p": "El navegador puede calcular SHA-256 sin subir el archivo. Identifica tus bytes, pero no demuestra quién los produjo.",
        "sig_h": "Firma del artefacto",
        "sig_p": "Las compilaciones continuas no publican firma de versión de One Link, Authenticode de Windows ni notarización Apple Developer ID.",
        "repro_h": "Reproducibilidad y procedencia",
        "repro_p": "Las compilaciones continuas no publican un resultado reproducible byte a byte. Cada artefacto sí incluye una atestación de procedencia de compilación de GitHub, verificable con gh attestation verify contra este repositorio: vincula esos bytes exactos al flujo de publicación que los emitió, de modo que la subida de un tercero no puede pasar por la nuestra. No es un documento de atestación firmado y vinculado al artefacto de One Link, y no permite reconstruir los bytes y compararlos.",
        "warning": "Trata estos artefactos como compilaciones de prueba. No ignores avisos del sistema suponiendo que este sitio verificó una firma.",
        "verify_cta": "Calcular SHA-256 local",
        "github_cta": "Inspeccionar artefactos en GitHub",
        "verify_title": "Calcular el hash localmente - One Link",
        "verify_desc": "Calcula localmente el SHA-256 y comprueba si existe una referencia autenticada.",
        "verify_kicker": "Herramienta de checksum local",
        "verify_h1": "Calcula el hash en tu navegador.",
        "verify_lede": "El navegador calcula SHA-256 localmente y el archivo nunca sale del dispositivo. Solo es una verificación autenticada si existe una referencia firmada y vinculada al artefacto. El canal continuo actual no la publica.",
        "drop_head": "Suelta el archivo aquí o haz clic para elegirlo.",
        "drop_sub": "El archivo permanece en esta pestaña. No se sube.",
        "verify_explain_h": "Lee el veredicto literalmente",
        "verify_p1": "Un SHA-256 local identifica el archivo y ayuda a detectar corrupción durante la transferencia.",
        "verify_p2": "Sin hash de referencia, la herramienta indica NO VERIFICADO. No insinuará que comprobó una firma o atestación.",
        "verify_p3": "Coincidir con un checksum sin firma tampoco prueba autoría. Un veredicto autenticado exige un artefacto versionado, un manifiesto firmado y una firma de versión verificada.",
        "release_title": "Estado de versiones - One Link",
        "release_desc": "Estado del canal de artefactos y requisitos para promocionar una versión inmutable.",
        "release_kicker": "Estado de versiones",
        "release_h1": "Las compilaciones continuas no son versiones inmutables.",
        "release_lede": "auto-latest es un canal preliminar mutable. Sus artefactos sirven para pruebas y cada uno incluye una atestación de procedencia de compilación de GitHub, pero el canal puede cambiar en el sitio y sigue sin publicar firma de artefacto, prueba de firma del editor ni resultado reproducible.",
        "current_h": "Disponible ahora",
        "current_p": "Los artefactos de escritorio compatibles siguen disponibles en GitHub y se etiquetan como compilaciones alfa continuas. El sitio no los presenta como versiones firmadas de producción.",
        "ready_h": "Puerta de promoción para una versión",
        "ready_items": ["Versión inmutable y commit de fuente explícitos.", "Nombres y SHA-256 exactos en un manifiesto firmado.", "Firma del editor cuando el sistema la admita.", "Procedencia, SBOM y atestaciones vinculadas al artefacto.", "Evidencia reproducible de una reconstrucción independiente."],
        "release_note": "Hasta cumplir cada puerta aplicable, las rutas públicas permanecen en el canal continuo claramente etiquetado.",
        "downloads_cta": "Ver compilaciones actuales",
        "releases_cta": "Inspeccionar versiones en GitHub",
        "builder_kicker": "Prueba de versión no disponible",
        "builder_h": "El código puede inspeccionarse, pero esta versión no está atestada.",
        "builder_p": "El archivo fuente continuo no tiene firma vinculada al artefacto ni atestación reproducible publicada. Puedes clonar, compilar y calcular un hash local, pero esta página no lo presentará como verificación de versión.",
        "builder_button": "Atestación de fuente no publicada",
    },
    "fr": {
        "download_title": "Télécharger les builds actuels - One Link",
        "download_desc": "Builds alpha actuels de One Link, disponibilité exacte et état réel de vérification.",
        "download_kicker": "Canal de build actuel",
        "download_h1": "Téléchargez avec l'état des preuves visible.",
        "download_lede": "Les artefacts de bureau sont des builds alpha continus et modifiables du canal auto-latest de GitHub. Ce ne sont pas des versions immuables. Chaque artefact porte une attestation de provenance de build GitHub, vérifiable avec gh attestation verify, qui prouve que le fichier provient du flux de publication de ce projet et non d'un tiers. Aucune signature d'artefact, signature d'éditeur ou preuve de reproductibilité n'est publiée.",
        "choose": "Choisissez la plateforme exacte",
        "rolling": "build alpha continu",
        "unavailable": "non publié",
        "source_status": "archive source, si disponible",
        "availability": "Des artefacts continus existent pour Windows Intel/AMD et ARM, macOS Apple Silicon et Linux Intel/AMD et ARM. Aucun artefact macOS Intel n'est publié. Android et iOS ne sont pas publiés.",
        "proof_h": "Ce que vous pouvez vérifier aujourd'hui",
        "hash_h": "Hash local",
        "hash_p": "Le navigateur peut calculer SHA-256 sans envoyer le fichier. Cela identifie vos octets, mais ne prouve pas qui les a produits.",
        "sig_h": "Signature de l'artefact",
        "sig_p": "Aucune signature de version One Link, Authenticode Windows ou notarisation Apple Developer ID n'est publiée pour les builds continus.",
        "repro_h": "Reproductibilité et provenance",
        "repro_p": "Aucun résultat reproductible octet par octet n'est publié pour les builds continus. Chaque artefact porte toutefois une attestation de provenance de build GitHub, vérifiable avec gh attestation verify sur ce dépôt : elle lie ces octets exacts au flux de publication qui les a émis, si bien que l'envoi d'un tiers ne peut pas passer pour le nôtre. Ce n'est pas un document d'attestation One Link signé et lié à l'artefact, et cela ne permet pas de reconstruire les octets pour les comparer.",
        "warning": "Traitez ces artefacts comme des builds de test. Ne contournez pas les avertissements du système en supposant que ce site a vérifié une signature.",
        "verify_cta": "Calculer un SHA-256 local",
        "github_cta": "Inspecter les artefacts GitHub",
        "verify_title": "Calculer le hash localement - One Link",
        "verify_desc": "Calculez SHA-256 localement et voyez si une référence authentifiée existe réellement.",
        "verify_kicker": "Outil de checksum local",
        "verify_h1": "Calculez le hash dans votre navigateur.",
        "verify_lede": "Le navigateur calcule SHA-256 localement et le fichier ne quitte jamais l'appareil. Le résultat n'est authentifié que si une référence signée liée à l'artefact existe. Le canal continu actuel n'en publie pas.",
        "drop_head": "Déposez le fichier ici ou cliquez pour le choisir.",
        "drop_sub": "Le fichier reste dans cet onglet. Aucun envoi n'a lieu.",
        "verify_explain_h": "Lisez le verdict littéralement",
        "verify_p1": "Un SHA-256 local identifie un fichier et aide à détecter une corruption de transfert.",
        "verify_p2": "Sans hash de référence, l'outil indique NON VÉRIFIÉ. Il ne prétend pas avoir vérifié une signature ou une attestation.",
        "verify_p3": "Une égalité avec un checksum non signé ne prouve pas l'auteur. Un verdict authentifié exige un artefact versionné, un manifeste signé et une signature vérifiée.",
        "release_title": "État des versions - One Link",
        "release_desc": "État du canal d'artefacts et critères requis avant une version immuable.",
        "release_kicker": "État des versions",
        "release_h1": "Les builds continus ne sont pas des versions immuables.",
        "release_lede": "auto-latest est un canal préliminaire modifiable. Ses artefacts servent aux tests et chacun porte une attestation de provenance de build GitHub, mais le canal peut changer sur place et ne publie toujours ni signature d'artefact, ni preuve de signature d'éditeur, ni résultat reproductible.",
        "current_h": "Disponible maintenant",
        "current_p": "Les artefacts de bureau pris en charge restent téléchargeables sur GitHub et sont étiquetés comme builds alpha continus. Le site ne les présente pas comme des versions de production signées.",
        "ready_h": "Critères de promotion d'une version",
        "ready_items": ["Version immuable et commit source explicites.", "Noms d'actifs et SHA-256 exacts dans un manifeste signé.", "Signature d'éditeur lorsque le système la prend en charge.", "Provenance, SBOM et attestations liées aux artefacts.", "Preuve de reproductibilité issue d'une reconstruction indépendante."],
        "release_note": "Jusqu'à satisfaction de chaque critère applicable, les routes publiques restent sur le canal continu clairement étiqueté.",
        "downloads_cta": "Voir les builds actuels",
        "releases_cta": "Inspecter les versions GitHub",
        "builder_kicker": "Preuve de version indisponible",
        "builder_h": "Le code peut être inspecté, mais cette version n'est pas attestée.",
        "builder_p": "L'archive source continue n'a ni signature liée à l'artefact ni attestation reproductible publiée. Vous pouvez cloner, compiler et calculer un hash local, mais cette page ne le présentera pas comme une vérification de version.",
        "builder_button": "Attestation source non publiée",
    },
    "de": {
        "download_title": "Aktuelle Builds herunterladen - One Link",
        "download_desc": "Aktuelle One Link Alpha-Builds, genaue Plattformverfügbarkeit und ehrlicher Prüfstatus.",
        "download_kicker": "Aktueller Build-Kanal",
        "download_h1": "Download mit sichtbarem Nachweisstatus.",
        "download_lede": "Die Desktop-Artefakte sind veränderliche kontinuierliche Alpha-Builds aus GitHubs auto-latest-Kanal. Sie sind keine unveränderliche versionierte Veröffentlichung. Jedes Artefakt trägt eine GitHub-Build-Herkunftsattestierung, prüfbar mit gh attestation verify, die belegt, dass die Datei aus dem Veröffentlichungs-Workflow dieses Projekts stammt und nicht von Dritten. Artefaktsignaturen, Herausgebersignaturen und reproduzierbare Build-Nachweise sind nicht veröffentlicht.",
        "choose": "Genaue Plattform wählen",
        "rolling": "kontinuierlicher Alpha-Build",
        "unavailable": "nicht veröffentlicht",
        "source_status": "Quellarchiv, falls verfügbar",
        "availability": "Kontinuierliche Artefakte gibt es für Windows Intel/AMD und ARM, macOS Apple Silicon sowie Linux Intel/AMD und ARM. Kein macOS-Intel-Artefakt ist veröffentlicht. Android und iOS sind nicht veröffentlicht.",
        "proof_h": "Was Sie heute prüfen können",
        "hash_h": "Lokaler Hash",
        "hash_p": "Der Browser kann SHA-256 ohne Upload berechnen. Das identifiziert Ihre Bytes, beweist aber nicht, wer sie erzeugt hat.",
        "sig_h": "Artefaktsignatur",
        "sig_p": "Für die kontinuierlichen Builds sind keine One-Link-Releasesignatur, Windows-Authenticode-Signatur oder Apple-Developer-ID-Notarisierung veröffentlicht.",
        "repro_h": "Reproduzierbarkeit und Herkunft",
        "repro_p": "Für die kontinuierlichen Builds ist kein bytegleiches Reproduktionsergebnis veröffentlicht. Jedes Artefakt trägt jedoch eine GitHub-Build-Herkunftsattestierung, prüfbar mit gh attestation verify gegen dieses Repository: Sie bindet genau diese Bytes an den Veröffentlichungs-Workflow, der sie erzeugt hat, sodass der Upload eines Dritten nicht als unserer gelten kann. Es ist keine signierte, artefaktgebundene One-Link-Attestierung und erlaubt keinen Neubau der Bytes zum Vergleich.",
        "warning": "Behandeln Sie diese Artefakte als Test-Builds. Umgehen Sie keine Systemwarnung in der Annahme, diese Website habe eine Signatur geprüft.",
        "verify_cta": "Lokalen SHA-256 berechnen",
        "github_cta": "GitHub-Artefakte prüfen",
        "verify_title": "Download lokal hashen - One Link",
        "verify_desc": "SHA-256 lokal berechnen und sehen, ob tatsächlich eine authentifizierte Referenz verfügbar ist.",
        "verify_kicker": "Lokales Prüfsummenwerkzeug",
        "verify_h1": "Datei im Browser hashen.",
        "verify_lede": "Der Browser berechnet SHA-256 lokal; die Datei verlässt das Gerät nicht. Das Ergebnis ist nur mit einer signierten artefaktgebundenen Referenz authentifiziert. Der aktuelle kontinuierliche Kanal veröffentlicht keine.",
        "drop_head": "Datei hier ablegen oder zum Auswählen klicken.",
        "drop_sub": "Die Datei bleibt in diesem Tab. Es erfolgt kein Upload.",
        "verify_explain_h": "Urteil wörtlich lesen",
        "verify_p1": "Ein lokaler SHA-256 identifiziert eine Datei und hilft, Übertragungsfehler zu erkennen.",
        "verify_p2": "Ohne Referenz-Hash meldet das Werkzeug NICHT VERIFIZIERT. Es behauptet keine Signatur- oder Attestierungsprüfung.",
        "verify_p3": "Auch eine Übereinstimmung mit einer unsignierten Prüfsumme beweist keine Urheberschaft. Ein authentifiziertes Urteil erfordert ein versioniertes Artefakt, ein signiertes Manifest und eine verifizierte Releasesignatur.",
        "release_title": "Veröffentlichungsstatus - One Link",
        "release_desc": "Status des Artefaktkanals und Voraussetzungen für eine unveränderliche Veröffentlichung.",
        "release_kicker": "Veröffentlichungsstatus",
        "release_h1": "Kontinuierliche Builds sind keine unveränderlichen Releases.",
        "release_lede": "auto-latest ist ein veränderlicher Vorabkanal. Seine Testartefakte tragen jeweils eine GitHub-Build-Herkunftsattestierung, können aber ausgetauscht werden und veröffentlichen weiterhin keine Signatur, Herausgeberprüfung oder Reproduktionsergebnis.",
        "current_h": "Jetzt verfügbar",
        "current_p": "Unterstützte Desktop-Artefakte bleiben auf GitHub verfügbar und sind als kontinuierliche Alpha-Builds gekennzeichnet. Die Website stellt sie nicht als signierte Produktionsreleases dar.",
        "ready_h": "Freigabekriterien für eine Version",
        "ready_items": ["Explizite unveränderliche Version und Quell-Commit.", "Exakte Asset-Namen und SHA-256-Werte in einem signierten Manifest.", "Herausgebersignatur, wo das Betriebssystem sie unterstützt.", "Artefaktgebundene Herkunft, SBOM und Attestierungen.", "Reproduzierbarkeitsnachweis aus einem unabhängigen Neubau."],
        "release_note": "Bis alle anwendbaren Kriterien erfüllt sind, bleiben öffentliche Routen auf dem klar bezeichneten kontinuierlichen Kanal.",
        "downloads_cta": "Aktuelle Builds ansehen",
        "releases_cta": "GitHub-Releases prüfen",
        "builder_kicker": "Release-Nachweis nicht verfügbar",
        "builder_h": "Der Quelltext ist prüfbar, dieses Release aber nicht attestiert.",
        "builder_p": "Das kontinuierliche Quellarchiv besitzt keine veröffentlichte artefaktgebundene Signatur oder Reproduzierbarkeitsattestierung. Klonen, Bauen und lokales Hashen sind möglich, werden hier aber nicht als Release-Verifizierung dargestellt.",
        "builder_button": "Quellattestierung nicht veröffentlicht",
    },
    "pt": {
        "download_title": "Descarregar builds atuais - One Link",
        "download_desc": "Builds alfa atuais do One Link, disponibilidade exata e estado real de verificação.",
        "download_kicker": "Canal de build atual",
        "download_h1": "Descarregue com o estado das provas visível.",
        "download_lede": "Os artefactos de desktop são builds alfa contínuos e mutáveis do canal auto-latest do GitHub. Não são uma versão imutável. Cada artefacto inclui uma atestação de proveniência de build do GitHub, verificável com gh attestation verify, que prova que o ficheiro saiu do fluxo de publicação deste projecto e não de terceiros. Não estão publicadas assinaturas de artefacto, assinatura do editor ou provas de build reproduzível.",
        "choose": "Escolha a plataforma exata",
        "rolling": "build alfa contínuo",
        "unavailable": "não publicado",
        "source_status": "arquivo de código, quando disponível",
        "availability": "Existem artefactos contínuos para Windows Intel/AMD e ARM, macOS Apple Silicon e Linux Intel/AMD e ARM. Não há artefacto macOS Intel publicado. Android e iOS não estão publicados.",
        "proof_h": "O que pode verificar hoje",
        "hash_h": "Hash local",
        "hash_p": "O navegador pode calcular SHA-256 sem enviar o ficheiro. Isso identifica os seus bytes, mas não prova quem os produziu.",
        "sig_h": "Assinatura do artefacto",
        "sig_p": "Os builds contínuos não publicam assinatura de versão One Link, Authenticode do Windows nem notarização Apple Developer ID.",
        "repro_h": "Reprodutibilidade e proveniência",
        "repro_p": "Os builds contínuos não publicam resultado reproduzível byte a byte. Cada artefacto inclui uma atestação de proveniência de build do GitHub, verificável com gh attestation verify neste repositório: liga esses bytes exactos ao fluxo de publicação que os emitiu, pelo que o envio de terceiros não pode passar pelo nosso. Não é um documento de atestação assinado e ligado ao artefacto da One Link e não permite reconstruir os bytes para comparar.",
        "warning": "Trate estes artefactos como builds de teste. Não contorne avisos do sistema supondo que este site verificou uma assinatura.",
        "verify_cta": "Calcular SHA-256 local",
        "github_cta": "Inspecionar artefactos no GitHub",
        "verify_title": "Calcular hash localmente - One Link",
        "verify_desc": "Calcule SHA-256 localmente e veja se existe uma referência autenticada.",
        "verify_kicker": "Ferramenta de checksum local",
        "verify_h1": "Calcule o hash no navegador.",
        "verify_lede": "O navegador calcula SHA-256 localmente e o ficheiro nunca sai do dispositivo. O resultado só é autenticado com uma referência assinada e vinculada ao artefacto. O canal contínuo atual não a publica.",
        "drop_head": "Largue o ficheiro aqui ou clique para escolher.",
        "drop_sub": "O ficheiro fica neste separador. Não há upload.",
        "verify_explain_h": "Leia o veredito literalmente",
        "verify_p1": "Um SHA-256 local identifica o ficheiro e ajuda a detetar corrupção na transferência.",
        "verify_p2": "Sem hash de referência, a ferramenta indica NÃO VERIFICADO. Não sugere que verificou assinatura ou atestação.",
        "verify_p3": "Uma correspondência com checksum não assinado também não prova autoria. Um veredito autenticado exige artefacto versionado, manifesto assinado e assinatura de versão verificada.",
        "release_title": "Estado das versões - One Link",
        "release_desc": "Estado do canal de artefactos e requisitos para promover uma versão imutável.",
        "release_kicker": "Estado das versões",
        "release_h1": "Builds contínuos não são versões imutáveis.",
        "release_lede": "auto-latest é um canal preliminar mutável. Os artefactos servem para testes e cada um inclui uma atestação de proveniência de build do GitHub, mas o canal pode mudar no lugar e continua sem publicar assinatura, prova de assinatura do editor ou resultado reproduzível.",
        "current_h": "Disponível agora",
        "current_p": "Os artefactos de desktop suportados continuam disponíveis no GitHub e são marcados como builds alfa contínuos. O site não os apresenta como versões de produção assinadas.",
        "ready_h": "Critérios de promoção de uma versão",
        "ready_items": ["Versão imutável e commit de código explícitos.", "Nomes e SHA-256 exatos num manifesto assinado.", "Assinatura do editor quando suportada pelo sistema.", "Proveniência, SBOM e atestações ligadas ao artefacto.", "Evidência reproduzível de uma reconstrução independente."],
        "release_note": "Até cumprir todos os critérios aplicáveis, as rotas públicas ficam no canal contínuo claramente identificado.",
        "downloads_cta": "Ver builds atuais",
        "releases_cta": "Inspecionar versões no GitHub",
        "builder_kicker": "Prova de versão indisponível",
        "builder_h": "O código pode ser inspecionado, mas esta versão não está atestada.",
        "builder_p": "O arquivo de código contínuo não tem assinatura ligada ao artefacto nem atestação reproduzível publicada. Pode clonar, compilar e calcular um hash local, mas esta página não o apresenta como verificação de versão.",
        "builder_button": "Atestação do código não publicada",
    },
    "it": {
        "download_title": "Scarica le build attuali - One Link",
        "download_desc": "Build alfa attuali di One Link, disponibilità esatta e stato reale della verifica.",
        "download_kicker": "Canale build attuale",
        "download_h1": "Scarica con lo stato delle prove visibile.",
        "download_lede": "Gli artefatti desktop sono build alfa continue e modificabili del canale auto-latest di GitHub. Non sono una release immutabile. Ogni artefatto porta un'attestazione di provenienza di build GitHub, verificabile con gh attestation verify, che dimostra che il file proviene dal flusso di pubblicazione di questo progetto e non da terzi. Non sono pubblicate firme degli artefatti, firme dell'editore o prove di build riproducibile.",
        "choose": "Scegli la piattaforma esatta",
        "rolling": "build alfa continua",
        "unavailable": "non pubblicato",
        "source_status": "archivio sorgente, se disponibile",
        "availability": "Esistono artefatti continui per Windows Intel/AMD e ARM, macOS Apple Silicon e Linux Intel/AMD e ARM. Nessun artefatto macOS Intel è pubblicato. Android e iOS non sono pubblicati.",
        "proof_h": "Cosa puoi verificare oggi",
        "hash_h": "Hash locale",
        "hash_p": "Il browser può calcolare SHA-256 senza caricare il file. Identifica i byte in tuo possesso, ma non prova chi li ha prodotti.",
        "sig_h": "Firma dell'artefatto",
        "sig_p": "Le build continue non pubblicano una firma di release One Link, Authenticode Windows o notarizzazione Apple Developer ID.",
        "repro_h": "Riproducibilità e provenienza",
        "repro_p": "Le build continue non pubblicano un risultato riproducibile byte per byte. Ogni artefatto porta però un'attestazione di provenienza di build GitHub, verificabile con gh attestation verify su questo repository: lega quei byte esatti al flusso di pubblicazione che li ha emessi, così il caricamento di terzi non può spacciarsi per il nostro. Non è un documento di attestazione One Link firmato e legato all'artefatto e non consente di ricostruire i byte per confrontarli.",
        "warning": "Tratta questi artefatti come build di test. Non aggirare gli avvisi del sistema supponendo che questo sito abbia verificato una firma.",
        "verify_cta": "Calcola SHA-256 locale",
        "github_cta": "Ispeziona gli artefatti GitHub",
        "verify_title": "Calcola l'hash localmente - One Link",
        "verify_desc": "Calcola SHA-256 localmente e verifica se esiste davvero un riferimento autenticato.",
        "verify_kicker": "Strumento checksum locale",
        "verify_h1": "Calcola l'hash nel browser.",
        "verify_lede": "Il browser calcola SHA-256 localmente e il file non lascia mai il dispositivo. Il risultato è autenticato solo con un riferimento firmato e legato all'artefatto. Il canale continuo attuale non lo pubblica.",
        "drop_head": "Trascina qui il file o fai clic per sceglierlo.",
        "drop_sub": "Il file resta in questa scheda. Non viene caricato.",
        "verify_explain_h": "Leggi il verdetto alla lettera",
        "verify_p1": "Un SHA-256 locale identifica il file e aiuta a rilevare corruzione durante il trasferimento.",
        "verify_p2": "Senza hash di riferimento, lo strumento indica NON VERIFICATO. Non suggerisce di aver controllato firme o attestazioni.",
        "verify_p3": "Anche una corrispondenza con un checksum non firmato non prova l'autore. Un verdetto autenticato richiede un artefatto versionato, un manifesto firmato e una firma verificata.",
        "release_title": "Stato delle release - One Link",
        "release_desc": "Stato del canale artefatti e requisiti per promuovere una release immutabile.",
        "release_kicker": "Stato delle release",
        "release_h1": "Le build continue non sono release immutabili.",
        "release_lede": "auto-latest è un canale preliminare modificabile. Gli artefatti servono ai test e ognuno porta un'attestazione di provenienza di build GitHub, ma il canale può cambiare sul posto e continua a non pubblicare firme, prove di firma dell'editore o risultati riproducibili.",
        "current_h": "Disponibile ora",
        "current_p": "Gli artefatti desktop supportati restano scaricabili da GitHub e sono etichettati come build alfa continue. Il sito non li presenta come release di produzione firmate.",
        "ready_h": "Criteri di promozione di una release",
        "ready_items": ["Versione immutabile e commit sorgente espliciti.", "Nomi degli asset e SHA-256 esatti in un manifesto firmato.", "Firma dell'editore dove supportata dal sistema.", "Provenienza, SBOM e attestazioni legate agli artefatti.", "Prova di riproducibilità da una ricostruzione indipendente."],
        "release_note": "Finché ogni criterio applicabile non è soddisfatto, le rotte pubbliche restano sul canale continuo chiaramente etichettato.",
        "downloads_cta": "Vedi le build attuali",
        "releases_cta": "Ispeziona le release GitHub",
        "builder_kicker": "Prova di release non disponibile",
        "builder_h": "Il sorgente è ispezionabile, ma questa release non è attestata.",
        "builder_p": "L'archivio sorgente continuo non ha una firma legata all'artefatto né un'attestazione riproducibile pubblicata. Puoi clonare, compilare e calcolare un hash locale, ma questa pagina non lo presenta come verifica della release.",
        "builder_button": "Attestazione sorgente non pubblicata",
    },
}


EXTENDED_COPY = {
    "en": {
        "site_manifest": "The verifier authenticates the website-asset manifest with the offline site-manifest key and then re-hashes every listed file. The checked-in manifest is stale after the current website changes, so the full check fails and no current bundle-integrity verdict is published. This mechanism never authenticates application installers or proves a reproducible release build.",
        "mirror_trust": "A mirror can prove bundle equality only when the signed website manifest is fresh and every listed hash matches. The checked-in manifest is currently stale, so that proof is unavailable until the offline signer publishes a new manifest. Even a passing website check would not prove reproducible application releases.",
        "mirror_script": "Source of the script: <a class=\"ol-cyan-text\" href=\"/mirror.sh\">/mirror.sh</a>. It verifies the site-manifest signature and all listed hashes, and must fail on the current stale manifest. The website signature does not sign or attest application release artifacts.",
        "mirror_verify": "The checked-in <code class=\"ol-inline-code\">/manifest.json</code> has a valid historical signature but stale asset hashes after current changes. Run the verifier: it must report failure. Do not call this website bundle verified until a new offline-signed manifest matches every tracked asset.",
        "mirror_count": "#   manifest signature: historical signature validates\n#   current verdict:    stale asset hashes; verification must fail",
        "transparency_r2": "The RELEASES R2 bucket holds source archives when available; desktop /download/ routes redirect to GitHub artifacts. The share store receives ciphertext, never the fragment key. One ShareObject Durable Object per item serializes retrieval claims, awaits R2 deletion before returning ciphertext, and schedules a 24-hour expiry alarm that reschedules cleanup failures. Provider outages can delay physical deletion.",
        "transparency_source": "The source and website bundle are public and mirrorable. The site-manifest signing key is held offline. Rolling application artifacts are not signed or reproducibly verified today; the code and protocol still survive in public clones.",
    },
    "es": {
        "site_manifest": "El verificador autentica el manifiesto web con la clave guardada sin conexión y recalcula cada archivo. El manifiesto incluido está desactualizado tras los cambios actuales, así que la comprobación completa falla y no hay un veredicto vigente de integridad. Tampoco autentica instaladores ni demuestra una build reproducible.",
        "mirror_trust": "Un espejo solo demuestra igualdad cuando el manifiesto web firmado está actualizado y coinciden todos los hashes. El actual está desactualizado, por lo que esa prueba no existe hasta publicar otro con la clave offline. Incluso entonces no probaría versiones reproducibles de la aplicación.",
        "mirror_script": "Fuente: <a class=\"ol-cyan-text\" href=\"/mirror.sh\">/mirror.sh</a>. Comprueba firma y hashes del sitio y debe fallar con el manifiesto desactualizado actual. La firma web no firma ni atestigua artefactos de la aplicación.",
        "mirror_verify": "El <code class=\"ol-inline-code\">/manifest.json</code> incluido conserva una firma histórica válida, pero sus hashes están desactualizados. El verificador debe fallar. No consideres verificado este bundle hasta que un manifiesto nuevo firmado offline coincida con todos los activos.",
        "mirror_count": "#   manifest signature: la firma histórica es válida\n#   veredicto actual:    hashes obsoletos; debe fallar",
        "transparency_r2": "El bucket RELEASES de R2 contiene archivos fuente; las rutas /download/ redirigen a GitHub. El almacén de share recibe cifrado, nunca la clave. Un ShareObject Durable Object por elemento serializa la recogida, espera al borrado R2 antes de devolver el cifrado y programa una alarma de 24 horas que reintenta fallos. Una caída del proveedor puede retrasar el borrado físico.",
        "transparency_source": "El código y el bundle web son públicos y replicables. La clave del manifiesto del sitio se guarda sin conexión. Los artefactos continuos de la aplicación no están firmados ni verificados como reproducibles; el código y el protocolo sobreviven en clones públicos.",
    },
    "fr": {
        "site_manifest": "Le vérificateur authentifie le manifeste web avec la clé hors ligne puis recalcule chaque fichier listé. Le manifeste inclus est périmé après les changements actuels : le contrôle complet échoue et aucun verdict d’intégrité actuel n’est publié. Il n’authentifie pas les installateurs et ne prouve pas un build reproductible.",
        "mirror_trust": "Un miroir ne prouve l’égalité que si le manifeste web signé est à jour et si tous les hash correspondent. Le manifeste actuel est périmé ; cette preuve reste indisponible jusqu’à une nouvelle signature hors ligne. Même un contrôle réussi ne prouverait pas la reproductibilité des versions applicatives.",
        "mirror_script": "Source : <a class=\"ol-cyan-text\" href=\"/mirror.sh\">/mirror.sh</a>. Il vérifie la signature et tous les hash du site et doit échouer avec le manifeste périmé actuel. La signature web ne signe ni n’atteste les artefacts applicatifs.",
        "mirror_verify": "Le <code class=\"ol-inline-code\">/manifest.json</code> inclus conserve une signature historique valide mais ses hash sont périmés. Le vérificateur doit échouer. Ne considérez pas ce bundle comme vérifié avant qu’un nouveau manifeste signé hors ligne corresponde à tous les assets.",
        "mirror_count": "#   manifest signature: signature historique valide\n#   verdict actuel :    hash périmés ; échec obligatoire",
        "transparency_r2": "Le bucket RELEASES de R2 contient les archives source disponibles ; les routes /download/ redirigent vers GitHub. Le partage reçoit le chiffré, jamais la clé. Un Durable Object ShareObject par élément sérialise la récupération, attend la suppression R2 avant de renvoyer le chiffré et programme une alarme de 24 heures qui réessaie les échecs. Une panne du fournisseur peut retarder la suppression physique.",
        "transparency_source": "Le code source et le bundle web sont publics et réplicables. La clé du manifeste du site est conservée hors ligne. Les artefacts applicatifs continus ne sont ni signés ni vérifiés reproductibles ; le code et le protocole survivent dans les clones publics.",
    },
    "de": {
        "site_manifest": "Der Prüfer authentifiziert das Website-Manifest mit dem Offline-Schlüssel und berechnet danach jede erfasste Datei neu. Das enthaltene Manifest ist nach den aktuellen Änderungen veraltet; die Gesamtprüfung schlägt fehl und es gibt kein aktuelles Integritätsurteil. Installer werden nicht authentifiziert und ein reproduzierbarer Build wird nicht bewiesen.",
        "mirror_trust": "Ein Spiegel belegt Gleichheit nur mit einem aktuellen signierten Website-Manifest und vollständig passenden Hashes. Das vorhandene Manifest ist veraltet; bis zu einer neuen Offline-Signatur ist dieser Nachweis nicht verfügbar. Auch ein Erfolg würde keine reproduzierbaren Anwendungs-Releases belegen.",
        "mirror_script": "Quelle: <a class=\"ol-cyan-text\" href=\"/mirror.sh\">/mirror.sh</a>. Es prüft Signatur und alle Website-Hashes und muss beim aktuell veralteten Manifest fehlschlagen. Die Website-Signatur signiert oder attestiert keine Anwendungsartefakte.",
        "mirror_verify": "Das enthaltene <code class=\"ol-inline-code\">/manifest.json</code> besitzt eine gültige historische Signatur, aber veraltete Asset-Hashes. Der Prüfer muss fehlschlagen. Dieses Bundle ist erst nach einem neuen offline signierten, vollständig passenden Manifest verifiziert.",
        "mirror_count": "#   manifest signature: historische Signatur ist gültig\n#   aktuelles Urteil:    veraltete Hashes; Prüfung muss fehlschlagen",
        "transparency_r2": "Der RELEASES-R2-Bucket enthält verfügbare Quellarchive; /download/ leitet zu GitHub. Der Share-Speicher erhält Chiffretext, nie den Fragment-Schlüssel. Ein ShareObject Durable Object je Objekt serialisiert Abrufe, wartet vor der Rückgabe auf die R2-Löschung und plant einen 24-Stunden-Alarm mit Wiederholung bei Fehlern. Providerausfälle können die physische Löschung verzögern.",
        "transparency_source": "Quelltext und Website-Bundle sind öffentlich und spiegelbar. Der Site-Manifest-Schlüssel wird offline gehalten. Kontinuierliche Anwendungsartefakte sind derzeit weder signiert noch reproduzierbar verifiziert; Code und Protokoll überleben in öffentlichen Klonen.",
    },
    "pt": {
        "site_manifest": "O verificador autentica o manifesto web com a chave offline e recalcula cada ficheiro. O manifesto incluído está desatualizado após as mudanças atuais; a verificação completa falha e não há veredicto de integridade vigente. Não autentica instaladores nem prova uma build reproduzível.",
        "mirror_trust": "Um espelho só prova igualdade com manifesto web assinado atual e todos os hashes coincidentes. O atual está desatualizado; a prova fica indisponível até nova assinatura offline. Mesmo uma verificação válida não provaria versões reproduzíveis da aplicação.",
        "mirror_script": "Fonte: <a class=\"ol-cyan-text\" href=\"/mirror.sh\">/mirror.sh</a>. Verifica assinatura e hashes do site e deve falhar com o manifesto atual desatualizado. A assinatura web não assina nem atesta artefactos da aplicação.",
        "mirror_verify": "O <code class=\"ol-inline-code\">/manifest.json</code> incluído mantém uma assinatura histórica válida, mas hashes desatualizados. O verificador deve falhar. Não considere este bundle verificado até um novo manifesto assinado offline coincidir com todos os ativos.",
        "mirror_count": "#   manifest signature: assinatura histórica válida\n#   veredicto atual:     hashes desatualizados; deve falhar",
        "transparency_r2": "O bucket RELEASES do R2 contém arquivos disponíveis; /download/ redireciona ao GitHub. A partilha recebe cifrado, nunca a chave. Um ShareObject Durable Object por item serializa a recolha, aguarda a eliminação R2 antes de devolver o cifrado e agenda um alarme de 24 horas que repete falhas. Uma indisponibilidade do fornecedor pode atrasar a eliminação física.",
        "transparency_source": "O código e o bundle web são públicos e espelháveis. A chave do manifesto do site é mantida offline. Os artefactos contínuos da aplicação não estão assinados nem verificados como reproduzíveis; o código e o protocolo sobrevivem em clones públicos.",
    },
    "it": {
        "site_manifest": "Il verificatore autentica il manifest web con la chiave offline e poi ricalcola ogni file elencato. Il manifest incluso è obsoleto dopo le modifiche attuali: il controllo completo fallisce e non esiste un verdetto d’integrità corrente. Non autentica gli installer né dimostra una build riproducibile.",
        "mirror_trust": "Un mirror prova l’uguaglianza solo con un manifest web firmato aggiornato e tutti gli hash corrispondenti. Quello attuale è obsoleto; la prova non è disponibile fino a una nuova firma offline. Anche un esito valido non proverebbe release applicative riproducibili.",
        "mirror_script": "Sorgente: <a class=\"ol-cyan-text\" href=\"/mirror.sh\">/mirror.sh</a>. Verifica firma e hash del sito e deve fallire con il manifest attuale obsoleto. La firma web non firma né attesta gli artefatti applicativi.",
        "mirror_verify": "Il <code class=\"ol-inline-code\">/manifest.json</code> incluso conserva una firma storica valida ma hash obsoleti. Il verificatore deve fallire. Non considerare verificato il bundle finché un nuovo manifest firmato offline non corrisponde a tutti gli asset.",
        "mirror_count": "#   manifest signature: firma storica valida\n#   verdetto attuale:   hash obsoleti; deve fallire",
        "transparency_r2": "Il bucket RELEASES di R2 contiene gli archivi disponibili; /download/ reindirizza a GitHub. La condivisione riceve cifrato, mai la chiave. Un ShareObject Durable Object per elemento serializza il recupero, attende la cancellazione R2 prima di restituire il cifrato e pianifica un allarme di 24 ore che ritenta i fallimenti. Un guasto del fornitore può ritardare la cancellazione fisica.",
        "transparency_source": "Il sorgente e il bundle web sono pubblici e replicabili. La chiave del manifest del sito è tenuta offline. Gli artefatti continui dell'applicazione non sono firmati né verificati come riproducibili; codice e protocollo sopravvivono nei cloni pubblici.",
    },
}


# Public capability and privacy copy is generated from one locale-aware model as
# well.  These strings deliberately describe the observable implementation
# boundary: the website is a pre-release client/infrastructure demo, not proof
# that every daemon target is deployed.
SURFACE_COPY = {
    "en": {
        "home_social": "Private pre-release messaging and file transfer. Direct paths where possible; encrypted relay fallback when needed. Infrastructure still observes connection metadata.",
        "home_aria": "Send messages and files. To your peers. Encrypted on supported paths.",
        "home_gradient": ["Encrypted", "on", "supported", "paths."],
        "chat_prompt": "tap any glowing dot to start a pseudonymous chat",
        "chat_aria": "Pseudonymous stranger chat",
        "chat_footer": "ephemeral &middot; no durable peer identity &middot; typing unlocks only after both sides report comparing all five SAS words over a separate trusted channel &middot; authentication depends on that honest external comparison &middot; Cloudflare relays ciphertext and sees metadata &middot; the peer can retain messages",
        "presence_title": "Live website-presence sessions. Other visitors see rotating IDs; Cloudflare receives ordinary connection metadata.",
        "features_desc": "A manually reviewed pre-release capability matrix, separating implemented paths, local demonstrations, infrastructure dependencies, and roadmap targets.",
        "features_lede": "This is a manually reviewed static pre-release matrix. The Worker endpoint /api/capabilities is an unsigned, hard-coded website-build advertisement, not a live daemon inventory or independent proof that a feature shipped.",
        "features_status": "manual review &middot; not live daemon telemetry",
        "features_file": "Native clients are designed for chunked, resumable transfers. Direct paths avoid server storage; encrypted relay paths may temporarily hold ciphertext. Size and throughput depend on the client build, filesystem, storage, relay, and network; no unlimited or 10 GB production guarantee is published.",
        "features_call": "Calls are a pre-release capability. Implemented encrypted paths prefer direct peer transport and may use identified relay or rendezvous services when required; those services can observe connection, timing, and size metadata.",
        "features_devices": "Two-device pairing and multi-device synchronization require distributed clients, a working transport, and user SAS comparison. The website card runs both primitive roles locally and does not prove phone pairing or cross-device synchronization.",
        "features_account": "No hosted One Link account is required today. Endpoints retain local identity state, while Cloudflare, GitHub, relays, and website services process the network or ephemeral state documented on /transparency/; this is not a claim that no database exists anywhere.",
        "features_crypto": "Implemented end-to-end-encrypted paths encrypt content before transport. Endpoints decrypt it; relay and website services may process ciphertext plus routing, timing, size, session, and connection metadata. Demo-only and capability-dependent paths are listed separately.",
        "features_route": "Direct paths are preferred. Encrypted relay, rendezvous, discovery, and availability services are used where required; current dependencies and retention boundaries are documented on /transparency/.",
        "features_pq": "The shipped browser code performs local post-quantum primitive self-tests. /api/session only registers a session and advertises an ephemeral Worker X25519 key; the browser completes neither ECDH nor ML-KEM, and the browser-to-Worker session is not PQ-secured.",
        "features_free_h": "Free to use today; costs and future access are not guaranteed.",
        "features_free": "There is no paid tier today. The AGPL-3.0 source is public and self-hostable. This is not a promise about future pricing, hosting, connectivity, hardware, relay capacity, or operator costs.",
        "features_future": "The cards below are roadmap targets or primitive demonstrations, not shipped daemon transport behavior unless a current versioned release and acceptance test say otherwise.",
        "features_private": "Three-hop Sphinx routing is a roadmap transport integration. Local WASM can exercise primitives, but current website traffic and the browser-to-Worker session do not use this route. Multi-hop routing can reduce what one relay learns; it does not guarantee anonymity.",
        "features_update": "The update checker can compare bytes with a checksum from the same mutable release channel. That detects some corruption but does not authenticate the publisher. Automatic and in-place installation is unavailable in the current desktop application; replacing a bundle remains an explicit user or operator action.",
        "how_desc": "How One Link is intended to pair and transfer: direct peer paths when available and encrypted relay infrastructure when needed, with explicit metadata and pre-release limitations.",
        "how_pair": "Installed clients are designed to pair two devices by QR plus a user-compared five-word SAS. The website runs both roles in one tab as a primitive self-test; it does not scan a camera, pair a phone, test transport, or guarantee a five-second completion time.",
        "how_send": "Implemented encrypted transfers prefer a direct peer path. When direct transport is unavailable, rendezvous or relay infrastructure may carry ciphertext and observe connection, timing, routing, and size metadata.",
        "how_done": "The recipient receives a copy. Sender storage, endpoint backups, and encrypted relay buffers depend on the selected transport, client configuration, delivery state, and retention policy.",
        "how_relay_lede": "Buffered relay delivery is a design target and varies by build. A relay can be unable to decrypt content while still observing routing identifiers, timing, sizes, and connection metadata; retention and failover require release-specific evidence.",
        "how_relay": "A capable relay carries ciphertext plus the routing information needed to forward it. End-to-end encryption protects content when correctly implemented, but does not hide all metadata or eliminate relay compromise risk.",
        "how_retention": "Do not assume a universal seven-day policy. Retention, deletion, retries, and delivery guarantees must be published and tested for the exact relay and client release in use.",
        "how_failover": "Volunteer relay discovery and automatic failover remain deployment-dependent. Availability is not guaranteed merely because the protocol permits other operators.",
        "how_update": "Frozen desktop bundles disable automatic and in-place installation at the runtime boundary. An update check can report availability from a mutable GitHub channel, but replacing the installed bundle remains an explicit user or operator action. Current rolling artifacts are not signed or reproducibly verified.",
        "how_hash": "A manually obtained replacement must be rejected when its SHA-256 differs from the expected value. A checksum from the same mutable channel can detect corruption but does not prove who produced the bytes; no authenticated rolling-update signature is published today.",
        "how_private": "Three-hop private routing is an integration target, not the path used by current website traffic. It can limit what any one relay sees, but endpoints, first and last hops, infrastructure providers, and timing observers can still infer metadata.",
        "how_audit": "The implementation and primitive names are open for review. No external firm has published an audit of the daemon, protocol, or website; local demos are not an audit.",
        "share_desc": "Encrypt a file up to 25 MB in your browser and upload ciphertext to Cloudflare R2. A per-object Durable Object schedules a 24-hour expiry alarm; provider outages can delay physical deletion. The fragment key is not sent in the HTTP request.",
        "share_h1": "Drop a file. Send the complete secret link. Anyone with that link can read it.",
        "share_app": "This is a convenience demo, not the full One Link protocol. Native pre-release clients prefer direct transfer and may use encrypted relay fallback. Limits and retention vary by transport, release, storage, and network; no unlimited or zero-retention guarantee is published.",
        "share_key": "The decryption key is in the URL fragment, which browsers do not include in the HTTP request. Anyone who obtains the complete link through forwarding, history, screenshots, logs, or compromise can fetch and decrypt the ciphertext.",
        "share_delete": "A per-object Durable Object serializes retrieval claims so only one can win. It buffers the ciphertext, awaits confirmed R2 deletion, and only then returns it. Its expiry alarm removes never-consumed objects and reschedules cleanup failures. Provider logs, metadata, caches, backups, outages, and recipient copies remain outside this one-shot guarantee.",
        "privacy_title": "Privacy and data processing - One Link",
        "privacy_desc": "One Link has no application signup or advertising analytics, while Cloudflare, GitHub, relays, Durable Objects, and R2 still process scoped network and service data.",
        "privacy_h1": "What this site processes.",
        "privacy_noaccount": "The site has no application signup, advertising analytics, cookies, tracking pixels, fingerprinting code, or third-party browser scripts. That does not mean no data is processed: hosting and transfer providers receive ordinary network requests.",
        "privacy_edge": "Cloudflare receives request metadata including IP addresses. MeshPresence holds a random per-tab ID, client-supplied approximate region, and activity time; ShareRate keys limits by a truncated subnet; R2 holds /share/ ciphertext; GitHub receives redirected artifact downloads.",
        "privacy_request": "We do not operate an email, phone, or username account database. Pairing state normally lives on endpoints, but providers, relays, recipients, and network observers may hold or infer metadata. The project cannot promise that identifying a downloader or correspondent is impossible.",
        "privacy_list": ["Identity and pairing material are primarily endpoint state; exports, backups, and recovery can create additional copies.", "No advertising or behavioral analytics are intentionally embedded in the site.", "The software is free to use today, not a guarantee of zero future hosting, network, hardware, or operator cost.", "Share and relay services can temporarily hold ciphertext; recipients keep what they receive.", "Connection providers can observe network metadata even when correctly implemented encryption protects content."],
        "security_desc": "A scoped pre-release security model: what implemented encryption protects, what infrastructure still processes, and which assurances remain unpublished.",
        "security_hero": "Security claims on this page are scoped to named implementations and evidence. Browser self-tests demonstrate primitives, not every daemon path, deployment, endpoint, or provider boundary.",
        "security_collect_h": "No application signup or advertising profile.",
        "security_collect": "The site avoids account identifiers, ad analytics, tracking pixels, fingerprinting code, and third-party browser scripts. Cloudflare and GitHub still receive ordinary request metadata, and website services process the fields listed on /transparency/.",
        "security_request": "The project does not maintain a conventional user or social-graph database, but it cannot claim identification is impossible: infrastructure providers, relays, endpoints, recipients, and network observers may retain or infer metadata.",
        "security_wire": "/api/session advertises an ephemeral Worker X25519 public key while its ML-KEM-768 public key is null and pending. It performs no client ECDH or ML-KEM-768 exchange and therefore establishes no secure or PQ-protected browser-to-Worker session. Local primitive self-tests do not change that boundary.",
        "security_pair": "A correctly completed two-device SAS comparison can expose an active substitution attempt. The same-tab website self-test does not provide that human, camera, transport, or second-device assurance.",
        "security_server": "The design keeps plaintext off correctly implemented relays. Relay and /share/ services may hold ciphertext temporarily, and compromise can expose encrypted payloads plus routing, timing, size, session, and connection metadata.",
        "security_traffic": "Three-hop Sphinx logic is available as a local primitive demonstration, but daemon transport wiring and website traffic do not currently provide the advertised private route. Multi-hop routing reduces some single-relay visibility; it does not guarantee anonymity.",
        "security_update": "Local hashing; rolling updates are not authenticated. A same-channel checksum can detect corruption but does not prove publisher identity. Current rolling artifacts have no published artifact signature or independent reproducibility result.",
        "security_install": "The command produces a local install fingerprint for comparison. It is tamper evidence only when compared with a separately authenticated baseline; comparison with another unauthenticated download does not prove provenance.",
        "security_disclosure": {
            "kicker": "Coordinated vulnerability disclosure",
            "heading": "Report privately; read the current commitments literally.",
            "lede": "The contributor-run inbox below is the published reporting path. It is monitored on a best-effort basis, not by a staffed 24/7 security team. Response, remediation, CVE, credit, bounty, safe-harbor, and disclosure dates are not guaranteed. The targets below preserve the program we want to build without presenting it as operating capacity today.",
            "contact_heading": "Published reporting path",
            "contact": "Email <a class=\"ol-cyan-text\" href=\"mailto:weareone@oneunity.earth\">weareone@oneunity.earth</a> with subject &quot;security report&quot;. <a class=\"ol-cyan-text\" href=\"/.well-known/security.txt\">/.well-known/security.txt</a> repeats this contact. Do not send exploit material or third-party personal data until scope and a protected exchange method are agreed. <a class=\"ol-cyan-text\" href=\"/share/\">/share/</a> is a temporary browser-sharing demo, not an authenticated security-report channel.",
            "response_heading": "Response targets; no SLA",
            "response": "Current status: contributor-run, with no guaranteed acknowledgement, triage, fix, or disclosure deadline. Non-guaranteed targets are acknowledgement within 72 hours, initial triage within 7 calendar days, and a mutually coordinated disclosure window often considered at 30 to 90 days. Impact, capacity, dependencies, reporter needs, and active exploitation can change the sequence or timing.",
            "bounty_heading": "No funded bounty or guaranteed CVE",
            "bounty": "There is no funded bug-bounty program and no promise of payment, reward, public acknowledgment, or permanent credit. One Link does not claim CNA status and cannot assign or guarantee a CVE. For an apparently qualifying finding, contributors may help submit information to an appropriate CNA or CVE Program intake; assignment and publication are controlled by those third parties. A funded program remains a target contingent on published rules, funding, and legally capable administration; no launch date is promised.",
            "severity_heading": "Intake severity, not entitlement",
            "severity": "The preliminary intake taxonomy is Critical for silent decryption, identity-key recovery, or universal pairing bypass; High for targeted peer attacks, release supply-chain compromise, or a ratchet break; Medium for timing side channels, denial of service, or metadata leakage beyond /transparency/; and Low for hardening or defense-in-depth gaps. It guides prioritization only and creates no response SLA, remediation deadline, bounty amount, safe-harbor guarantee, or CVE entitlement.",
            "safe_harbor_heading": "Safe-harbor intent; not a legal guarantee",
            "safe_harbor": "Contributors intend to welcome good-faith, authorized, proportionate research on your own devices and accounts and not to initiate claims solely because such research is reported responsibly. That intent is not legal advice, a contract, authorization to access another person's data or systems, or a waiver of law. Project contributors cannot bind hosting providers, users, individual maintainers, rightsholders, law enforcement, or other third parties. Do not exfiltrate, modify, or destroy others' data or degrade service; request written authorization when scope is uncertain. A formal, versioned, legally reviewed safe-harbor policy remains the target.",
            "track_heading": "Evidence and track record",
            "track": "The contributor-maintained /audits/ register links published external reports when they exist and records selected internal review notes. It is not guaranteed exhaustive and is not an independent audit, release attestation, response log, or proof that every report was resolved.",
        },
        "transparency_status_h": "Implementation boundary reviewed 2026-07-22.",
        "transparency_status": ["This page is a contributor-maintained disclosure, not an independently audited or cryptographically timestamped transparency report. The previous canary date expired and no current separately signed canary is published.", "Commit history can show edits after publication, but absence or staleness is not a reliable gag-order signal.", "Treat legal-request counts as unverified until a dated, separately signed statement and a documented retention procedure are published."],
        "transparency_content": "Implemented end-to-end-encrypted paths keep plaintext at endpoints. Relays and servers may process ciphertext plus connection, routing, timing, and size metadata. /api/session is not PQ-secured today, and a local primitive self-test does not prove every daemon path.",
        "transparency_social": "Pairing state normally resides on endpoints and no hosted social-graph product is operated today. Website, relay, provider, and recipient systems still process ephemeral routing, session, delivery, and connection metadata.",
        "transparency_location": "The site does not request precise browser geolocation. Presence clients send a coarse estimate derived from their timezone, which can be wrong; Cloudflare still receives the request IP and other ordinary connection metadata.",
        "transparency_mesh": "MeshPresence holds a random per-tab session ID, a client-supplied approximate region, and activity timestamps for the live website view. Other visitors see pseudonymous IDs; Cloudflare receives ordinary connection metadata outside the Durable Object state.",
        "transparency_native": "/native currently returns a protocol advertisement, and /api/session registers a session plus an ephemeral Worker X25519 public key. NativeSession is a non-load-bearing stub; no browser ECDH, ML-KEM, WebTransport channel, or established session key is created.",
        "transparency_rate": "ShareRate keys a token bucket by a truncated IPv4 /24 or IPv6 /48 subnet string and persists token count plus refill time. It does not store the full address in DO storage, but Cloudflare receives the request IP at the network edge.",
        "transparency_daemon": "The source is self-hostable and some installed direct or local operations may work without this site. Current discovery, rendezvous, relay, sharing, downloads, updates, DNS, GitHub, and Cloudflare paths can still depend on deployed infrastructure; continuity has not been proven for every build.",
        "transparency_relays": "Community relay operation and decentralized discovery are design goals. Current production availability, independent operators, gossip discovery, and failover are not established merely by publishing relay-capable source.",
        "transparency_close": "Public source and static mirrors reduce one hosting dependency. Static mirrors do not provide presence, share, session registration, download routing, or other Worker APIs unless an operator deploys compatible services.",
        "transparency_refresh_h": "Refreshes are manual, not guaranteed monthly.",
        "mesh_desc": "A live visualization of website presence sessions, not installed One Link nodes or relays. Visitors see rotating pseudonymous IDs and coarse client-supplied regions; Cloudflare sees connection metadata.",
        "mesh_lede": "Each dot is a validated website-presence session, not proof of an installed One Link node or relay. The field is an illustrative browser visualization, not live routing telemetry. Capable tabs encrypt chat payloads before Cloudflare relays them, and typing remains locked until both sides report comparing all five SAS words over a separate trusted channel. Authentication depends on that honest external comparison; no durable peer identity is created. Cloudflare still sees connection metadata. The UI exposes a rotating ID plus a coarse client-supplied region.",
        "mesh_presence": "This map shows website-presence sessions only. It is not an inventory of daemon nodes, relays, transport paths, or network capacity.",
        "mesh_ids": "Dots use random, rotating per-tab IDs that are pseudonymous to other visitors, not anonymous to infrastructure. Cloudflare receives ordinary connection metadata and the selected peer can retain anything received.",
        "mesh_region": "Dots cluster by a coarse client-supplied estimate derived from browser timezone. It is illustrative, can be wrong, and is not measured relay topology or precise geolocation.",
        "builder_relay": "Relay software is intended to forward encrypted bundles without content keys, but an operator can observe connection, routing, timing, and size metadata. A public one-line installer and production relay directory are not currently published.",
        "builder_command": "# Public relay installer not published. Build and review the relay source before experimental use.",
        "builder_footnote": "A relay does not automatically appear on this website-presence map. Discovery, reputation, health selection, and failover require deployed, tested infrastructure.",
        "builder_crates": {
            "ol_transfer": "Integrated chunk-fetch engine over QUIC: idempotent local reads, bounded batch fetches, Bloom and scoped-Bloom inventory exchange, and optional fountain symbols. It moves already-formed ChunkRecord bytes; chunk AEAD and rekeying belong to other layers. Crate tests do not by themselves prove the complete application transfer path.",
            "ol_threshold_recovery": "Shamir k-of-n secret sharing over GF(2^8), proactive share refresh, and optional field-witness masking. It does not implement BN multisignatures or per-signer R values. Python bindings expose the primitives; real-device recovery still requires versioned product-integration evidence.",
            "ol_confidential": "Provider trait and ChaCha20-Poly1305 software-sealing baseline. An opt-in Windows TPM feature adds a TPM-rooted attestation key, while master-key sealing remains software-based. Secure Enclave, SGX, SEV-SNP, and TrustZone backends are not implemented; daemon use and platform guarantees require build and runtime evidence.",
            "ol_routing": "Tau-weighted cost and Dijkstra primitives over empirical RTT, jitter, throughput, and loss, plus claim-corroboration helpers. A Python binding exposes the graph math; this crate is not evidence that released daemon traffic follows a field gradient.",
            "ol_duress": "DuressGate policy primitives classify precomputed real, decoy, and rejected passphrases, derive volume secrets, and emit a covert marker. This is not a filesystem, account UI, or released-daemon integration, and it does not prove that a decoy is believable under coercion.",
        },
        "access_qr": "The current website self-test runs both pairing roles in one tab and displays a QR generated by the production primitive. It does not open the camera, scan a phone or second device, test transport, or complete real two-device pairing; the SAS can be copied for accessibility review only.",
        "mirror_desc": "Mirror the static One Link documentation and local self-tests. Dynamic presence, sharing, session, topology, and download-routing features require separately deployed compatible services.",
        "mirror_lede": "The public pages and local WASM self-tests can be served as a static AGPL-3.0 bundle. The canonical site also uses a Cloudflare Worker, Durable Objects, R2, GitHub downloads, and DNS; those dynamic services are not reproduced by copying files.",
        "mirror_latency": "A local mirror can reduce document latency and preserve static pages. Its exact compressed size changes, and it does not provide the canonical Worker, Durable Object, R2, GitHub, DNS, presence, or transfer services by itself.",
        "mirror_resilience": "AGPL-3.0 permits copying and modification. Static mirrors preserve published pages while reachable; they do not prove that daemon discovery, rendezvous, relays, updates, downloads, or the network continue without their current operators.",
        "mirror_local": "The static pages and purely local primitive self-tests render from a simple server. API-dependent presence, chat relay, sharing, session registration, topology, and download routing do not work unless the mirror deploys compatible services.",
        "mirror_tor": "An onion service needs no public DNS or public CA, and ordinary clients are not directly given the origin address. Tor, network observers, host configuration, provider logs, or compromise can still expose metadata.",
        "mirror_ipfs": "Content remains available only while at least one reachable node or provider pins it and clients can reach a gateway or IPFS peer. A CID proves content addressing, not perpetual availability.",
        "roadmap_note": "Everything below is a proposal or acceptance target, not current availability. Use the changelog and versioned release evidence for shipped status; neither future tense nor a primitive demo proves daemon integration.",
        "roadmap_fs": "Target: extend forward-secret key evolution to every supported transfer path and publish release-specific interoperability tests. This card does not assert that every current message or chunk path already has that property.",
        "roadmap_operator": "Target: relays should not receive content keys, while operators will still observe connection, routing, timing, and size metadata. Deployment evidence must verify the boundary.",
        "roadmap_cards": {
            "silent_loss": (
                "Target: make unrecoverable gaps explicit.",
                "Target: detect peer-state divergence and represent every unrecoverable message as an authenticated, ordered gap instead of silently omitting it. Threat model: crashes, restore, replay, loss, reordering, duplicate delivery, and malicious truncation within the published retention window; endpoint deletion or compromise remains out of scope. Promote only after versioned fault-injection and cross-device recovery tests prove no undetected gaps across the supported matrix.",
            ),
            "remote_pair": (
                "Target: local, user-verified QR pairing.",
                "Target: accept pairing only from an expiring, single-use QR exchange completed on two devices with out-of-band SAS confirmation, with no URL-token bootstrap in supported clients. Threat model: remote link theft, replay, substitution, malicious relays, and network MITM; compromised endpoints or cameras and dishonest SAS confirmation remain residual risks. Promote only after physical-device negative tests and packet captures prove the documented boundary.",
            ),
            "timing_analysis": (
                "Target: measured resistance to traffic analysis.",
                "Target: offer bounded, optional padding and cover schedules that reduce a stated observer's ability to distinguish real sends. The threat model and evidence must name observer vantage, duration, collusion, latency, bandwidth, and anonymity set; a global observer is not presumed defeated. Promote only after published trace-classification tests meet a preregistered advantage bound without unbounded traffic, battery, or latency cost.",
            ),
            "hardware_keys": (
                "Target: hardware-backed identity keys where verified.",
                "Target: use supported non-exportable hardware operations and fail closed when the required tier is unavailable. The threat model must separate user-mode malware, administrator or kernel compromise, physical access, firmware or supply-chain compromise, and signing-oracle abuse; hardware does not make a compromised endpoint trustworthy. Promote each platform only with versioned key-export, attestation, downgrade, reset, backup, and impersonation tests on named hardware.",
            ),
            "telemetry": (
                "Target: privacy-preserving operational evidence.",
                "Target: no advertising or behavioral profiling and no undeclared event collection. Reliability or security measurements, if any, must be opt-in or demonstrably aggregate and minimized, purpose-bound, documented with fields, processors, and retention, and covered by a threat model. Promote any no-telemetry wording only after build, network, and storage audits prove no undeclared emissions; local counters and infrastructure metadata remain disclosed.",
            ),
        },
        "about_operation": "Some direct or local-network operations can work after installation and pairing. Discovery, rendezvous, relay delivery, sharing, downloads, and updates may require deployed Internet infrastructure; offline and operator-independence claims need release-specific tests.",
        "about_use": "The design aims to minimize retained content and metadata. Endpoints, recipients, networks, CDNs, relays, and storage providers can still observe or retain metadata, and transfer limits depend on the selected build, transport, storage, and network.",
        "about_open": "The AGPL-3.0 source is public and forks remain subject to the license. The software is free to use today, but hosting, connectivity, hardware, and relay operation have costs and future service pricing is not guaranteed.",
        "about_release": "auto-latest is a mutable prerelease channel with no published artifact signature, publisher code signing, independent reproducibility result, or provenance attestation. Treat its artifacts as test builds.",
        "about_covenant": "The durable promise is the AGPL-3.0 right to inspect, run, modify, and share source. Privacy, availability, cost, and cryptographic properties still depend on the exact build, configuration, endpoints, transport, and providers.",
        "terms_dependency": "One Link is self-hostable software, while current operation may depend on deployed discovery, rendezvous, relay, hosting, DNS, GitHub, Cloudflare, and update infrastructure. Publishing source does not guarantee the network continues with or without any particular operator.",
        "audits_desc": "A contributor-maintained register of published external audits and selected internal review notes. No external firm has published an audit; entries are not independently attested.",
        "audits_lede": "This contributor-maintained register links published external reports when they exist and records selected internal review notes. It is not guaranteed exhaustive and is not an independent audit or release attestation.",
        "audits_history": "A public commit history can show how this page changed. It is not a separately signed, independently timestamped audit register and does not prove that every finding was recorded or closed.",
        "changelog_lede": "Selected historical notes through the date shown below. Git history may contain later changes; these entries describe past claims and do not establish current release, signature, audit, or deployment status.",
        "404_hero": "This page does not exist. Static pages and available services can still be reached from the links below; availability depends on their current infrastructure.",
        "404_download": "Free and open-source. Rolling test artifacts exist for supported desktop platforms; artifact signatures and every-platform coverage are not published.",
        "404_primitives": "The website runs local cryptographic primitive self-tests. It does not establish a phone pairing or PQ-secured browser-to-Worker session.",
        "404_mesh": "A live map of website-presence sessions and an illustrative field, not an inventory of installed nodes, relays, or routing telemetry.",
        "one_network": "One Link is a pre-release tool for reconnection. Endpoint identity is designed to remain local, while current discovery, relays, hosting, downloads, updates, and providers can process metadata and create infrastructure dependencies.",
        "one_crypto": "The security page separates implemented paths, local primitive self-tests, and roadmap targets. Post-quantum primitives, onion routing, recovery, ratchets, and hardware integration are not universal guarantees across every current session or build.",
    },
    "es": {
        "home_social": "Mensajería y transferencia de archivos privadas en versión preliminar. Rutas directas cuando sea posible y relé cifrado cuando sea necesario. La infraestructura aún ve metadatos de conexión.",
        "home_aria": "Envía mensajes y archivos. A tus contactos. Cifrado en las rutas compatibles.",
        "home_gradient": ["Cifrado", "en", "rutas", "compatibles."],
        "chat_prompt": "toca cualquier punto brillante para iniciar un chat seudónimo",
        "chat_aria": "Chat seudónimo con una persona desconocida",
        "chat_footer": "efímero &middot; sin identidad duradera &middot; escribir solo se habilita cuando ambos declaran comparar las cinco palabras SAS por un canal de confianza separado &middot; la autenticación depende de esa comparación honesta &middot; Cloudflare retransmite el cifrado y ve metadatos &middot; el par puede conservar mensajes",
        "presence_title": "Sesiones de presencia del sitio en vivo. Otros visitantes ven IDs rotatorios; Cloudflare recibe metadatos de conexión normales.",
        "features_desc": "Matriz manual de capacidades preliminares que separa rutas implementadas, demos locales, dependencias y objetivos futuros.",
        "features_lede": "Esta matriz estática preliminar se revisa manualmente. /api/capabilities es un anuncio no firmado y fijo de esta build del sitio, no un inventario en vivo del daemon ni una prueba independiente de entrega.",
        "features_status": "revisión manual &middot; no es telemetría del daemon",
        "features_file": "Los clientes nativos están diseñados para transferencias fragmentadas y reanudables. Las rutas directas evitan almacenamiento en servidor; los relés cifrados pueden guardar texto cifrado temporalmente. Tamaño y rendimiento dependen de la build, sistema de archivos, almacenamiento, relé y red; no se publica una garantía ilimitada ni de 10 GB.",
        "features_call": "Las llamadas son una capacidad preliminar. Las rutas cifradas implementadas prefieren transporte directo y pueden usar servicios identificados de relé o encuentro; estos observan metadatos de conexión, tiempo y tamaño.",
        "features_devices": "El emparejamiento entre dos dispositivos y la sincronización requieren clientes distribuidos, transporte funcional y comparación del SAS por las personas. La tarjeta web ejecuta ambos roles localmente y no prueba emparejamiento con un móvil ni sincronización entre dispositivos.",
        "features_account": "Hoy no se exige una cuenta alojada de One Link. Los endpoints guardan identidad local y Cloudflare, GitHub, relés y servicios web procesan el estado de red o efímero descrito en /transparency/; no significa que no exista ninguna base de datos en ningún lugar.",
        "features_crypto": "Las rutas E2EE implementadas cifran contenido antes del transporte. Los endpoints lo descifran; relés y servicios web pueden procesar texto cifrado y metadatos de ruta, tiempo, tamaño, sesión y conexión. Las rutas de demo o dependientes de capacidad se listan aparte.",
        "features_route": "Se prefieren rutas directas. Cuando hacen falta se usan relés cifrados y servicios de encuentro, descubrimiento y disponibilidad; las dependencias y retenciones actuales se documentan en /transparency/.",
        "features_pq": "El navegador ejecuta auto-pruebas locales de primitivas postcuánticas. /api/session solo registra una sesión y anuncia una clave X25519 efímera del Worker; el navegador no completa ECDH ni ML-KEM y la sesión navegador-Worker no está protegida con PQ.",
        "features_free_h": "Gratis hoy; costes y acceso futuro no están garantizados.",
        "features_free": "Hoy no hay nivel de pago. El código AGPL-3.0 es público y autoalojable. No es una promesa sobre precios, alojamiento, conectividad, hardware, capacidad de relés ni costes de operadores futuros.",
        "features_future": "Las tarjetas siguientes son objetivos de hoja de ruta o demos de primitivas, no comportamiento entregado del transporte del daemon salvo que una versión actual y una prueba de aceptación lo demuestren.",
        "features_private": "El enrutamiento Sphinx de tres saltos es una integración futura. WASM local puede probar primitivas, pero el tráfico actual del sitio y la sesión navegador-Worker no usan esa ruta. Varios saltos reducen lo que aprende un relé; no garantizan anonimato.",
        "features_update": "El comprobador de actualizaciones puede comparar bytes con un checksum del mismo canal mutable. Detecta cierta corrupción, pero no autentica al editor. La instalación automática y en el lugar no está disponible en la aplicación de escritorio actual; sustituir el paquete sigue siendo una acción explícita del usuario u operador.",
        "how_desc": "Cómo pretende emparejar y transferir One Link: rutas directas cuando estén disponibles y relés cifrados cuando hagan falta, con límites preliminares y de metadatos explícitos.",
        "how_pair": "Los clientes instalados están diseñados para emparejar dos dispositivos mediante QR y un SAS de cinco palabras comparado por las personas. El sitio ejecuta ambos roles en una pestaña como auto-prueba; no escanea cámara, empareja móvil, prueba transporte ni garantiza cinco segundos.",
        "how_send": "Las transferencias cifradas implementadas prefieren una ruta directa. Si no está disponible, la infraestructura de encuentro o relé puede transportar texto cifrado y observar metadatos de conexión, tiempo, ruta y tamaño.",
        "how_done": "El destinatario recibe una copia. El almacenamiento del remitente, copias de seguridad de endpoints y buffers cifrados dependen del transporte, configuración, estado de entrega y política de retención.",
        "how_relay_lede": "La entrega almacenada por relé es un objetivo y varía según la build. Un relé puede no descifrar contenido y aun ver identificadores de ruta, tiempos, tamaños y conexiones; retención y failover requieren evidencia por versión.",
        "how_relay": "Un relé capaz transporta texto cifrado y la información de ruta necesaria. E2EE protege el contenido si está bien implementado, pero no oculta todos los metadatos ni elimina el riesgo de compromiso del relé.",
        "how_retention": "No supongas una política universal de siete días. Retención, borrado, reintentos y garantías de entrega deben publicarse y probarse para la versión exacta del relé y cliente.",
        "how_failover": "El descubrimiento y failover de relés voluntarios dependen del despliegue. La disponibilidad no queda garantizada porque el protocolo permita otros operadores.",
        "how_update": "La aplicación de escritorio actual no ofrece instalación automática ni sustitución en el lugar. Una comprobación puede informar de disponibilidad desde un canal mutable de GitHub, pero sustituir el paquete instalado sigue siendo una acción explícita del usuario u operador. Los artefactos continuos no están firmados ni verificados como reproducibles.",
        "how_hash": "Un reemplazo obtenido manualmente debe rechazarse si su SHA-256 difiere del valor esperado. Un checksum del mismo canal mutable puede detectar corrupción, pero no prueba quién produjo los bytes; hoy no se publica una firma autenticada para actualizaciones continuas.",
        "how_private": "El enrutamiento privado de tres saltos es un objetivo de integración, no la ruta del tráfico web actual. Puede limitar lo que ve cada relé, pero endpoints, primer y último salto, proveedores y observadores temporales aún infieren metadatos.",
        "how_audit": "La implementación y las primitivas están abiertas a revisión. Ninguna firma externa ha publicado una auditoría del daemon, protocolo o sitio; las demos locales no son una auditoría.",
        "share_desc": "Cifra en el navegador un archivo de hasta 25 MB y sube el cifrado a Cloudflare R2. Un Durable Object por objeto programa una alarma de 24 horas; una caída del proveedor puede retrasar el borrado físico. La clave del fragmento no se envía en la solicitud HTTP.",
        "share_h1": "Suelta un archivo. Envía el enlace secreto completo. Quien tenga ese enlace puede leerlo.",
        "share_app": "Esta es una demo de conveniencia, no todo el protocolo. Los clientes nativos preliminares prefieren transferencia directa y pueden usar relé cifrado. Límites y retención varían por transporte, versión, almacenamiento y red; no hay garantía ilimitada ni de retención cero.",
        "share_key": "La clave está en el fragmento de URL, que el navegador no incluye en la solicitud HTTP. Quien obtenga el enlace completo por reenvío, historial, captura, registro o compromiso puede descargar y descifrar el contenido.",
        "share_delete": "Un Durable Object por objeto serializa las recogidas para que solo una gane. Guarda el cifrado en memoria, espera al borrado R2 confirmado y solo entonces lo devuelve. La alarma elimina objetos no recogidos y reintenta los fallos. Logs, metadatos, cachés, backups, caídas y copias del destinatario quedan fuera de la garantía de un solo uso.",
        "privacy_title": "Privacidad y tratamiento de datos - One Link",
        "privacy_desc": "One Link no tiene registro de aplicación ni analítica publicitaria, pero Cloudflare, GitHub, relés, Durable Objects y R2 procesan datos de red y servicio limitados.",
        "privacy_h1": "Lo que procesa este sitio.",
        "privacy_noaccount": "El sitio no tiene registro de aplicación, analítica publicitaria, cookies, píxeles, código de fingerprinting ni scripts de navegador de terceros. Eso no significa que no se procese información: los proveedores reciben solicitudes de red normales.",
        "privacy_edge": "Cloudflare recibe metadatos de solicitud, incluida la IP. MeshPresence guarda un ID aleatorio por pestaña, región aproximada enviada por el cliente y hora de actividad; ShareRate limita por subred truncada; R2 guarda cifrado de /share/; GitHub recibe descargas redirigidas.",
        "privacy_request": "No operamos una base de datos de cuentas con correo, teléfono o usuario. El emparejamiento suele vivir en endpoints, pero proveedores, relés, destinatarios y observadores pueden guardar o inferir metadatos. No podemos prometer que identificar a quien descarga o se comunica sea imposible.",
        "privacy_list": ["La identidad y el emparejamiento son principalmente estado del endpoint; exportaciones, copias y recuperación crean más copias.", "No se incrustan deliberadamente anuncios ni analítica conductual.", "El software es gratis hoy, no una garantía de coste futuro cero para alojamiento, red, hardware u operadores.", "Servicios de share y relé pueden guardar texto cifrado temporalmente; los destinatarios conservan lo recibido.", "Los proveedores de conexión observan metadatos aun cuando el cifrado correcto protege el contenido."],
        "security_desc": "Modelo de seguridad preliminar y limitado: qué protege el cifrado implementado, qué procesa la infraestructura y qué garantías no se publican.",
        "security_hero": "Las afirmaciones de seguridad se limitan a implementaciones y evidencia nombradas. Las auto-pruebas del navegador demuestran primitivas, no cada ruta, despliegue, endpoint o proveedor.",
        "security_collect_h": "Sin registro de aplicación ni perfil publicitario.",
        "security_collect": "El sitio evita identificadores de cuenta, analítica publicitaria, píxeles, fingerprinting y scripts de terceros. Cloudflare y GitHub reciben metadatos normales y los servicios procesan los campos de /transparency/.",
        "security_request": "No mantenemos una base convencional de usuarios o grafo social, pero no podemos afirmar que identificar sea imposible: proveedores, relés, endpoints, destinatarios y observadores pueden conservar o inferir metadatos.",
        "security_wire": "/api/session anuncia una clave pública X25519 efímera del Worker mientras su clave pública ML-KEM-768 es nula y está pendiente. No completa ECDH del cliente ni un intercambio ML-KEM-768, por lo que no establece una sesión navegador-Worker segura o protegida con PQ. Las auto-pruebas locales no cambian ese límite.",
        "security_pair": "Una comparación SAS real entre dos dispositivos puede revelar sustitución activa. La auto-prueba de una pestaña no ofrece garantía humana, de cámara, transporte o segundo dispositivo.",
        "security_server": "El diseño evita texto claro en relés bien implementados. Relés y /share/ pueden guardar cifrado temporalmente, y un compromiso expone payload cifrado y metadatos de ruta, tiempo, tamaño, sesión y conexión.",
        "security_traffic": "La lógica Sphinx de tres saltos existe como demo local, pero el transporte del daemon y el tráfico web no ofrecen hoy esa ruta. Varios saltos reducen cierta visibilidad; no garantizan anonimato.",
        "security_update": "Hash local; las actualizaciones continuas no están autenticadas. Un checksum del mismo canal detecta corrupción pero no prueba al editor. No hay firma de artefacto ni reproducción independiente publicada.",
        "security_install": "El comando produce una huella local para comparar. Solo es evidencia de manipulación frente a una referencia autenticada aparte; otra descarga no autenticada no prueba procedencia.",
        "security_disclosure": {
            "kicker": "Divulgación coordinada de vulnerabilidades",
            "heading": "Informa en privado; interpreta literalmente los compromisos actuales.",
            "lede": "El buzón gestionado por contribuidores que figura abajo es la vía publicada para informar. Se atiende con el mejor esfuerzo, no por un equipo de seguridad 24/7. No se garantizan plazos de respuesta, corrección, CVE, crédito, recompensa, puerto seguro ni divulgación. Los objetivos siguientes mantienen el programa que queremos construir sin presentarlo como capacidad operativa actual.",
            "contact_heading": "Vía de reporte publicada",
            "contact": "Escribe a <a class=\"ol-cyan-text\" href=\"mailto:weareone@oneunity.earth\">weareone@oneunity.earth</a> con el asunto &quot;security report&quot;. <a class=\"ol-cyan-text\" href=\"/.well-known/security.txt\">/.well-known/security.txt</a> repite este contacto. No envíes material de explotación ni datos personales de terceros hasta acordar el alcance y un método de intercambio protegido. <a class=\"ol-cyan-text\" href=\"/share/\">/share/</a> es una demo temporal de intercambio en el navegador, no un canal autenticado para informes de seguridad.",
            "response_heading": "Objetivos de respuesta; sin SLA",
            "response": "Estado actual: gestión por contribuidores, sin plazo garantizado de acuse de recibo, triage, corrección o divulgación. Los objetivos no garantizados son acusar recibo en 72 horas, realizar un triage inicial en 7 días naturales y considerar una ventana de divulgación coordinada de 30 a 90 días. El impacto, la capacidad, las dependencias, las necesidades de quien informa y la explotación activa pueden cambiar el orden o los tiempos.",
            "bounty_heading": "Sin recompensa financiada ni CVE garantizado",
            "bounty": "No existe un programa de bug bounty financiado ni se promete pago, recompensa, reconocimiento público o crédito permanente. One Link no afirma ser CNA y no puede asignar ni garantizar un CVE. Ante un hallazgo aparentemente apto, los contribuidores pueden ayudar a remitir información a una CNA adecuada o al canal de entrada del Programa CVE; esas terceras partes controlan la asignación y publicación. Un programa financiado sigue siendo un objetivo sujeto a reglas publicadas, fondos y administración con capacidad jurídica; no se promete fecha de lanzamiento.",
            "severity_heading": "Severidad de entrada, no un derecho",
            "severity": "La taxonomía preliminar considera Crítico el descifrado silencioso, la recuperación de claves de identidad o el bypass universal de emparejamiento; Alto los ataques dirigidos, el compromiso de la cadena de suministro o la ruptura del ratchet; Medio los canales temporales, la denegación de servicio o filtraciones superiores a /transparency/; y Bajo el endurecimiento o la defensa en profundidad. Solo orienta la prioridad y no crea SLA, plazo de corrección, importe de recompensa, garantía de puerto seguro ni derecho a CVE.",
            "safe_harbor_heading": "Intención de puerto seguro; no es una garantía legal",
            "safe_harbor": "Los contribuidores pretenden acoger investigación de buena fe, autorizada y proporcionada en tus propios dispositivos y cuentas, y no iniciar reclamaciones solo porque se informe de ella responsablemente. Esa intención no es asesoramiento legal, contrato, autorización para acceder a datos o sistemas ajenos ni renuncia a la ley. Los contribuidores no pueden vincular a proveedores de alojamiento, usuarios, mantenedores individuales, titulares de derechos, fuerzas del orden ni otras terceras partes. No exfiltres, modifiques o destruyas datos ajenos ni degrades el servicio; solicita autorización escrita si el alcance no está claro. Una política formal, versionada y revisada jurídicamente sigue siendo el objetivo.",
            "track_heading": "Evidencia e historial",
            "track": "El registro /audits/, mantenido por contribuidores, enlaza informes externos publicados cuando existen y recoge notas internas seleccionadas. No garantiza exhaustividad y no es una auditoría independiente, atestación de versión, registro de respuesta ni prueba de que cada informe se haya resuelto.",
        },
        "transparency_status_h": "Límite de implementación revisado el 2026-07-22.",
        "transparency_status": ["Esta divulgación la mantienen contribuidores; no es un informe auditado ni sellado criptográficamente. El canario anterior caducó y no se publica uno actual firmado aparte.", "El historial muestra ediciones, pero ausencia o retraso no es una señal fiable de una orden de silencio.", "Considera no verificados los conteos legales hasta publicar una declaración fechada y firmada con un procedimiento de retención."],
        "transparency_content": "Las rutas E2EE implementadas mantienen el texto claro en endpoints. Relés y servidores procesan cifrado y metadatos. /api/session no está protegido con PQ y una auto-prueba local no demuestra cada ruta del daemon.",
        "transparency_social": "El emparejamiento suele residir en endpoints y hoy no operamos un producto de grafo social. Sistemas web, relés, proveedores y destinatarios procesan metadatos efímeros de ruta, sesión, entrega y conexión.",
        "transparency_location": "El sitio no solicita geolocalización precisa. El cliente envía una estimación gruesa según zona horaria, que puede ser errónea; Cloudflare recibe la IP y metadatos normales.",
        "transparency_mesh": "MeshPresence guarda un ID aleatorio por pestaña, región aproximada enviada por el cliente y tiempos de actividad. Otros ven IDs seudónimos; Cloudflare recibe metadatos fuera del estado del Durable Object.",
        "transparency_native": "/native devuelve hoy un anuncio de protocolo y /api/session registra una sesión y clave X25519 efímera. NativeSession es un stub no crítico; no crea ECDH, ML-KEM, WebTransport ni clave de sesión establecida.",
        "transparency_rate": "ShareRate usa como clave una subred IPv4 /24 o IPv6 /48 truncada y persiste tokens y hora de recarga. No guarda la IP completa en el DO, pero Cloudflare la recibe en el borde.",
        "transparency_daemon": "El código es autoalojable y algunas operaciones directas o locales pueden funcionar sin el sitio. Descubrimiento, encuentro, relé, share, descargas, actualizaciones, DNS, GitHub y Cloudflare aún dependen de infraestructura; no se probó continuidad para cada build.",
        "transparency_relays": "La operación comunitaria y el descubrimiento descentralizado son objetivos. Publicar código no demuestra disponibilidad productiva, operadores independientes, gossip ni failover.",
        "transparency_close": "El código público y los espejos estáticos reducen una dependencia. No ofrecen presencia, share, registro de sesión, rutas de descarga ni otras APIs sin desplegar servicios compatibles.",
        "transparency_refresh_h": "Las revisiones son manuales, no mensuales garantizadas.",
        "mesh_desc": "Visualización en vivo de sesiones de presencia web, no de nodos o relés instalados. Los visitantes ven IDs seudónimos y regiones aproximadas; Cloudflare ve metadatos de conexión.",
        "mesh_lede": "Cada punto es una sesión validada de presencia web, no prueba de un nodo o relé instalado. El campo es ilustrativo, no telemetría de rutas. Las pestañas compatibles cifran el chat antes de que Cloudflare lo retransmita y escribir queda bloqueado hasta que ambos declaran comparar las cinco palabras SAS por un canal de confianza separado. La autenticación depende de esa comparación honesta y no se crea identidad duradera. Cloudflare sigue viendo metadatos. La interfaz muestra un ID rotatorio y una región aproximada enviada por el cliente.",
        "mesh_presence": "El mapa muestra solo sesiones de presencia del sitio. No inventaría nodos, relés, rutas de transporte ni capacidad de red.",
        "mesh_ids": "Los puntos usan IDs aleatorios por pestaña, seudónimos para visitantes, no anónimos para la infraestructura. Cloudflare recibe metadatos y el par puede conservar lo recibido.",
        "mesh_region": "Los puntos se agrupan por una estimación gruesa enviada por el cliente y derivada de la zona horaria. Es ilustrativa, puede fallar y no es topología de relés ni geolocalización precisa.",
        "builder_relay": "El software de relé pretende reenviar paquetes cifrados sin claves de contenido, pero el operador ve metadatos de conexión, ruta, tiempo y tamaño. No se publica hoy un instalador de una línea ni un directorio productivo.",
        "builder_command": "# Instalador público de relé no publicado. Compila y revisa el código antes del uso experimental.",
        "builder_footnote": "Un relé no aparece automáticamente en este mapa de presencia web. Descubrimiento, reputación, salud y failover requieren infraestructura desplegada y probada.",
        "builder_crates": {
            "ol_transfer": "Motor integrado de obtención de fragmentos sobre QUIC: lecturas locales idempotentes, lotes acotados, intercambio de inventario Bloom y Bloom acotado, y símbolos fountain opcionales. Mueve bytes ChunkRecord ya formados; el AEAD de fragmento y la rotación de claves pertenecen a otras capas. Las pruebas de la crate no demuestran por sí solas el flujo completo de la aplicación.",
            "ol_threshold_recovery": "Secreto compartido Shamir k-de-n sobre GF(2^8), refresco proactivo de partes y enmascaramiento opcional ligado a un testigo de campo. No implementa multifirma BN ni valores R por firmante. Los bindings Python exponen las primitivas; la recuperación real entre dispositivos aún requiere evidencia de integración versionada.",
            "ol_confidential": "Trait de proveedor y base de sellado software con ChaCha20-Poly1305. Una función opcional de Windows TPM añade una clave de atestación arraigada en TPM, mientras el sellado de la clave maestra sigue siendo software. Los backends Secure Enclave, SGX, SEV-SNP y TrustZone no están implementados; el uso del daemon y las garantías de plataforma requieren evidencia de build y ejecución.",
            "ol_routing": "Primitivas de coste ponderado por tau y Dijkstra sobre RTT, jitter, rendimiento y pérdidas observados, más ayudas de corroboración. Un binding Python expone las matemáticas del grafo; esta crate no demuestra que el tráfico de un daemon publicado siga un gradiente de campo.",
            "ol_duress": "Las primitivas de política DuressGate clasifican frases precalculadas como reales, señuelo o rechazadas, derivan secretos de volumen y emiten un marcador encubierto. No son un sistema de archivos, una interfaz de cuenta ni integración en un daemon publicado, y no prueban que el señuelo resulte creíble bajo coacción.",
        },
        "access_qr": "La autoprueba web ejecuta ambos roles en una pestaña y muestra un QR generado por la primitiva real. No abre cámara, escanea un segundo dispositivo, prueba transporte ni completa emparejamiento real; el SAS solo puede copiarse para revisar accesibilidad.",
        "mirror_desc": "Replica documentación estática y auto-pruebas locales. Presencia, share, sesión, topología y rutas de descarga requieren servicios compatibles desplegados aparte.",
        "mirror_lede": "Las páginas públicas y auto-pruebas WASM locales pueden servirse como bundle AGPL-3.0 estático. El sitio canónico también usa Worker, Durable Objects, R2, GitHub y DNS; copiar archivos no replica esos servicios.",
        "mirror_latency": "Un espejo local reduce latencia documental y conserva páginas estáticas. Su tamaño cambia y no aporta por sí solo Worker, DO, R2, GitHub, DNS, presencia o transferencias canónicas.",
        "mirror_resilience": "AGPL-3.0 permite copiar y modificar. Los espejos preservan páginas mientras sean accesibles; no prueban que descubrimiento, encuentro, relés, actualizaciones, descargas o red sigan sin operadores actuales.",
        "mirror_local": "Las páginas y auto-pruebas puramente locales funcionan desde un servidor simple. Presencia, chat, share, sesión, topología y descargas requieren servicios compatibles.",
        "mirror_tor": "Un servicio onion no necesita DNS ni CA públicos y no entrega directamente la IP de origen a clientes normales. Tor, observadores, configuración, logs o compromiso aún exponen metadatos.",
        "mirror_ipfs": "El contenido solo sigue disponible mientras algún nodo o proveedor accesible lo fije y el cliente alcance un gateway o peer. Un CID prueba direccionamiento, no disponibilidad perpetua.",
        "roadmap_note": "Todo lo siguiente es una propuesta u objetivo de aceptación, no disponibilidad actual. El changelog y la evidencia de una versión fijada mandan; el futuro o una demo no prueban integración.",
        "roadmap_fs": "Objetivo: extender evolución de claves con secreto hacia adelante a cada ruta compatible y publicar pruebas por versión. Esta tarjeta no afirma que cada mensaje o fragmento actual ya la tenga.",
        "roadmap_operator": "Objetivo: que relés no reciban claves de contenido, aunque operadores vean metadatos de conexión, ruta, tiempo y tamaño. La evidencia de despliegue debe verificarlo.",
        "roadmap_cards": {
            "silent_loss": (
                "Objetivo: hacer explícitas las lagunas irrecuperables.",
                "Objetivo: detectar divergencia entre pares y representar cada mensaje irrecuperable como una laguna autenticada y ordenada, no omitirlo en silencio. Modelo de amenazas: caídas, restauración, replay, pérdida, reordenación, duplicados y truncamiento malicioso dentro de la retención publicada; el borrado o compromiso del endpoint queda fuera de alcance. Promover solo cuando pruebas versionadas de inyección de fallos y recuperación entre dispositivos demuestren que no hay lagunas sin detectar en la matriz compatible.",
            ),
            "remote_pair": (
                "Objetivo: emparejamiento QR local verificado por la persona.",
                "Objetivo: aceptar solo un intercambio QR de un uso y con caducidad, completado en dos dispositivos con confirmación SAS fuera de banda, sin arranque por token URL en clientes compatibles. Modelo de amenazas: robo remoto del enlace, replay, sustitución, relés maliciosos y MITM de red; endpoints o cámaras comprometidos y una confirmación SAS deshonesta siguen siendo riesgos residuales. Promover solo tras pruebas negativas en dispositivos físicos y capturas de paquetes que demuestren el límite documentado.",
            ),
            "timing_analysis": (
                "Objetivo: resistencia medida al análisis de tráfico.",
                "Objetivo: ofrecer relleno y tráfico de cobertura opcionales y acotados que reduzcan la capacidad de un observador definido para distinguir envíos reales. El modelo de amenazas y la evidencia deben nombrar posición, duración, colusión, latencia, ancho de banda y conjunto de anonimato; no se presume derrotado un observador global. Promover solo cuando pruebas publicadas de clasificación de trazas cumplan un límite de ventaja prerregistrado sin coste ilimitado de tráfico, batería o latencia.",
            ),
            "hardware_keys": (
                "Objetivo: claves de identidad respaldadas por hardware donde se verifique.",
                "Objetivo: usar operaciones de hardware no exportables compatibles y fallar de forma cerrada si falta el nivel exigido. El modelo de amenazas debe separar malware de usuario, compromiso de administrador o kernel, acceso físico, firmware o cadena de suministro y abuso como oráculo de firma; el hardware no vuelve confiable un endpoint comprometido. Promover cada plataforma solo con pruebas versionadas de exportación, atestación, downgrade, reinicio, copia e impersonación en hardware identificado.",
            ),
            "telemetry": (
                "Objetivo: evidencia operativa que preserve la privacidad.",
                "Objetivo: nada de publicidad o perfiles conductuales ni eventos no declarados. Cualquier medición de fiabilidad o seguridad debe ser opt-in o agregada y minimizada de forma demostrable, estar ligada a un fin, documentar campos, procesadores y retención, y tener modelo de amenazas. Promover una afirmación de ausencia de telemetría solo cuando auditorías de build, red y almacenamiento demuestren que no hay emisiones no declaradas; los contadores locales y metadatos de infraestructura siguen divulgados.",
            ),
        },
        "about_operation": "Algunas operaciones directas o LAN pueden funcionar tras instalar y emparejar. Descubrimiento, encuentro, relé, share, descargas y actualizaciones pueden exigir Internet; las afirmaciones offline e independientes requieren pruebas por versión.",
        "about_use": "El diseño busca minimizar contenido y metadatos retenidos. Endpoints, destinatarios, redes, CDN, relés y almacenamiento aún observan o retienen metadatos; los límites dependen de build, transporte, almacenamiento y red.",
        "about_open": "El código AGPL-3.0 es público y los forks quedan sujetos a la licencia. El software es gratis hoy, pero alojamiento, conectividad, hardware y relés cuestan y no se garantiza precio futuro.",
        "about_release": "auto-latest es un canal preliminar mutable sin firma de artefacto, firma de editor, reproducción independiente ni procedencia publicadas. Trátalo como build de prueba.",
        "about_covenant": "La promesa duradera es el derecho AGPL-3.0 a inspeccionar, ejecutar, modificar y compartir el código. Privacidad, disponibilidad, coste y cripto dependen de build, configuración, endpoints, transporte y proveedores.",
        "terms_dependency": "One Link es software autoalojable, pero hoy puede depender de descubrimiento, encuentro, relés, alojamiento, DNS, GitHub, Cloudflare y actualizaciones. Publicar código no garantiza que la red siga sin un operador concreto.",
        "audits_desc": "Registro mantenido por contribuidores de auditorías externas publicadas y notas internas seleccionadas. Ninguna firma externa ha publicado una auditoría; las entradas no están atestadas independientemente.",
        "audits_lede": "Este registro enlaza informes externos cuando existen y notas internas seleccionadas. No garantiza exhaustividad ni es una auditoría independiente o atestación de versión.",
        "audits_history": "El historial público muestra cambios de la página. No es un registro de auditoría firmado y sellado independientemente ni prueba que cada hallazgo se registró o cerró.",
        "changelog_lede": "Notas históricas seleccionadas hasta la fecha indicada. Git puede contener cambios posteriores; estas entradas no establecen el estado actual de versiones, firmas, auditorías o despliegue.",
        "404_hero": "Esta página no existe. Las páginas y servicios disponibles siguen en los enlaces; su disponibilidad depende de la infraestructura actual.",
        "404_download": "Gratis y de código abierto. Hay artefactos continuos de prueba para escritorios compatibles; no se publican firmas ni cobertura de todas las plataformas.",
        "404_primitives": "El sitio ejecuta auto-pruebas criptográficas locales. No establece emparejamiento con un móvil ni una sesión navegador-Worker protegida con PQ.",
        "404_mesh": "Mapa en vivo de sesiones de presencia web y campo ilustrativo, no inventario de nodos, relés ni telemetría de rutas.",
        "one_network": "One Link es una herramienta preliminar de reconexión. La identidad pretende quedar local, pero descubrimiento, relés, hosting, descargas, actualizaciones y proveedores procesan metadatos y crean dependencias.",
        "one_crypto": "Seguridad separa rutas implementadas, auto-pruebas y objetivos. Primitivas PQ, onion, recuperación, ratchets e integración hardware no son garantías universales de cada sesión o build.",
    },
}

from release_truth_locales import LOCALIZED_SURFACE_COPY

SURFACE_COPY.update(LOCALIZED_SURFACE_COPY)
_surface_keys = set(SURFACE_COPY["en"])
for _locale, _surface_copy in SURFACE_COPY.items():
    missing = _surface_keys - set(_surface_copy)
    extra = set(_surface_copy) - _surface_keys
    if missing or extra:
        raise RuntimeError(
            f"surface-copy key drift for {_locale}: missing={sorted(missing)}, extra={sorted(extra)}"
        )

_structured_surface_keys = {
    "builder_crates": {
        "ol_transfer",
        "ol_threshold_recovery",
        "ol_confidential",
        "ol_routing",
        "ol_duress",
    },
    "roadmap_cards": {
        "silent_loss",
        "remote_pair",
        "timing_analysis",
        "hardware_keys",
        "telemetry",
    },
    "security_disclosure": {
        "kicker",
        "heading",
        "lede",
        "contact_heading",
        "contact",
        "response_heading",
        "response",
        "bounty_heading",
        "bounty",
        "severity_heading",
        "severity",
        "safe_harbor_heading",
        "safe_harbor",
        "track_heading",
        "track",
    },
}
for _locale, _surface_copy in SURFACE_COPY.items():
    for _key, _expected in _structured_surface_keys.items():
        _value = _surface_copy[_key]
        if not isinstance(_value, dict) or set(_value) != _expected:
            _actual = sorted(_value) if isinstance(_value, dict) else type(_value).__name__
            raise RuntimeError(
                f"structured surface-copy drift for {_locale}.{_key}: "
                f"expected={sorted(_expected)}, actual={_actual}"
            )
    if not all(isinstance(value, str) and value for value in _surface_copy["builder_crates"].values()):
        raise RuntimeError(f"invalid builder-crate copy for {_locale}")
    if not all(isinstance(value, str) and value for value in _surface_copy["security_disclosure"].values()):
        raise RuntimeError(f"invalid security-disclosure copy for {_locale}")
    if not all(
        isinstance(value, tuple)
        and len(value) == 2
        and all(isinstance(part, str) and part for part in value)
        for value in _surface_copy["roadmap_cards"].values()
    ):
        raise RuntimeError(f"invalid roadmap-card copy for {_locale}")


MAIN_RE = re.compile(r'<main id="main">[\s\S]*?</main>', re.MULTILINE)
BUILDER_RE = re.compile(
    r'<section class="section">(?:(?!</section>)[\s\S])*?'
    r'id="ol-rebuild-btn"(?:(?!</section>)[\s\S])*?'
    r'id="ol-rebuild-out"(?:(?!</section>)[\s\S])*?</section>',
    re.MULTILINE,
)
# The whitespace-or-close boundary is security critical: ``<p`` without it also
# matches SVG ``<path>`` elements and can corrupt icons during structural edits.
PARAGRAPH_RE = re.compile(
    r'<p(?P<attrs>(?:\s[^>]*)?)>(?P<body>(?:(?!</p>)[\s\S])*)</p>',
    re.MULTILINE,
)
ARTICLE_RE = re.compile(r'<article class="ol-tile">(?:(?!</article>)[\s\S])*</article>', re.MULTILINE)
ARTICLE_ANY_RE = re.compile(r'<article(?P<attrs>[^>]*)>(?:(?!</article>)[\s\S])*</article>', re.MULTILINE)
LIST_ITEM_RE = re.compile(r'<li>(?:(?!</li>)[\s\S])*</li>', re.MULTILINE)
SECTION_RE = re.compile(r'<section(?P<attrs>[^>]*)>(?:(?!</section>)[\s\S])*</section>', re.MULTILINE)
H1_RE = re.compile(r'<h1(?P<attrs>[^>]*)>(?:(?!</h1>)[\s\S])*</h1>', re.MULTILINE)
H2_RE = re.compile(r'<h2(?P<attrs>[^>]*)>(?:(?!</h2>)[\s\S])*</h2>', re.MULTILINE)
UL_PROSE_RE = re.compile(r'<ul class="ol-list-prose">(?:(?!</ul>)[\s\S])*</ul>', re.MULTILINE)

UPDATE_INSTALL_SCOPE = "updater-install-boundary"
HISTORICAL_UPDATE_SCOPE = "historical-autoinstall-correction"
FROZEN_UPDATE_INSTALL_HEADING = "Frozen bundles do not install updates."
FROZEN_UPDATE_INSTALL_BODY = (
    "The hardened frozen desktop runtime has no automatic, silent, or in-place install path. "
    "Update status may be displayed, but no Settings toggle can turn an authenticated "
    "auto-installer on because that capability is unavailable."
)
FROZEN_UPDATE_OPERATOR_HEADING = "Replacement stays explicit."
FROZEN_UPDATE_OPERATOR_BODY = (
    "A user or operator must obtain and replace a frozen bundle explicitly. "
    "ONE_LINK_EXPERIMENTAL_AUTOINSTALL is a legacy name retained in source history, not "
    "evidence that a frozen bundle can update itself."
)


def rewrite_frozen_update_section(text: str, c: dict[str, object], scope: dict[str, str]) -> str:
    """Replace the current updater surface with the frozen-runtime boundary."""

    hits = 0

    def section(match: re.Match[str]) -> str:
        nonlocal hits
        block = match.group(0)
        if (
            "ONE_LINK_EXPERIMENTAL_AUTOINSTALL" not in block
            and f'data-claim-scope="{UPDATE_INSTALL_SCOPE}"' not in block
        ):
            return block
        hits += 1
        attrs = re.sub(r'\sdata-claim-scope="[^"]*"', "", match.group("attrs"))
        block = re.sub(
            r"^<section[^>]*>",
            f'<section{attrs} data-claim-scope="{UPDATE_INSTALL_SCOPE}">',
            block,
            count=1,
        )
        block, heading_count = H2_RE.subn(f'<h2>{scope["update_h"]}</h2>', block, count=1)
        if heading_count != 1:
            raise ValueError("updater section heading drift")
        block, lede_count = re.subn(
            r'<p class="lede(?: [^"]*)?">(?:(?!</p>)[\s\S])*</p>',
            f'<p class="lede">{c["how_update"]}</p>',
            block,
            count=1,
        )
        if lede_count != 1:
            raise ValueError("updater section lede drift")

        articles = (
            (str(scope["update_h"]), str(c["how_hash"])),
            (FROZEN_UPDATE_INSTALL_HEADING, FROZEN_UPDATE_INSTALL_BODY),
            (FROZEN_UPDATE_OPERATOR_HEADING, FROZEN_UPDATE_OPERATOR_BODY),
        )
        article_index = 0

        def article(_: re.Match[str]) -> str:
            nonlocal article_index
            heading, body = articles[article_index]
            article_index += 1
            return f'<article class="ol-tile"><h3>{heading}</h3><p>{body}</p></article>'

        block, article_count = ARTICLE_RE.subn(article, block)
        if article_count != len(articles):
            raise ValueError(
                f"updater section article drift: expected {len(articles)}, found {article_count}"
            )
        return block

    result = SECTION_RE.sub(section, text)
    if hits != 1:
        raise ValueError(f"updater section drift: expected 1, found {hits}")
    return result


def rewrite_historical_autoinstall_entry(text: str) -> str:
    """Keep the old experiment discoverable without presenting it as current capability."""

    hits = 0

    def section(match: re.Match[str]) -> str:
        nonlocal hits
        block = match.group(0)
        is_target = (
            f'data-claim-scope="{HISTORICAL_UPDATE_SCOPE}"' in block
            or "ONE_LINK_EXPERIMENTAL_AUTOINSTALL" in block
            or "auto_install_starting" in block
        )
        if not is_target:
            return block
        hits += 1
        return f'''<section class="section" data-claim-scope="{HISTORICAL_UPDATE_SCOPE}">
    <div class="container">
      <span class="kicker">2026-05-25</span>
      <h2><span class="grad">daemon</span> historical updater experiment - current frozen install path disabled</h2>
      <ul>
        <li><strong>Historical note (superseded):</strong> The original entry announced &ldquo;auto-install ON by default&rdquo; and a &ldquo;silent background install,&rdquo; with a Settings opt-out, the <code class="ol-inline-code">ONE_LINK_EXPERIMENTAL_AUTOINSTALL</code> override, and <code class="ol-inline-code">auto_install_*</code> progress events. Those statements document an earlier experiment; they do not describe current frozen desktop bundles.</li>
        <li><strong>Current correction:</strong> Hardened frozen desktop bundles disable automatic and in-place installation at the runtime boundary. Update checks may report availability, but replacement remains an explicit user or operator action.</li>
        <li><strong>Current verification boundary:</strong> A same-channel checksum can detect corruption but does not authenticate the publisher. Current rolling artifacts are unsigned and are not reproducibly verified.</li>
        <li><strong>Historical companion work:</strong> The entry also recorded <code class="ol-inline-code">verify-this-install</code>, backup test commands, and recovery-share proof tools. This dated note is not evidence of their availability in a current pinned release.</li>
      </ul>
    </div>
  </section>'''

    result = SECTION_RE.sub(section, text)
    if hits != 1:
        raise ValueError(f"historical updater entry drift: expected 1, found {hits}")
    return result


def page_path(locale: str, slug: str) -> Path:
    prefix = LOCALE_PATHS[locale]
    return DIST / prefix / slug / "index.html" if prefix else DIST / slug / "index.html"


def platform_rows(c: dict[str, object]) -> str:
    rolling = c["rolling"]
    unavailable = c["unavailable"]
    return f'''<div class="alts ol-tag-grid" id="platforms" aria-label="Platform builds">
          <a href="/download/windows-x86_64" class="ol-platform-row">Windows (Intel/AMD) <span class="ol-platform-status ready">.exe, {rolling}</span></a>
          <a href="/download/windows-arm64" class="ol-platform-row">Windows (ARM64) <span class="ol-platform-status ready">.exe, {rolling}</span></a>
          <a href="/download/macos-arm64" class="ol-platform-row">macOS (Apple Silicon) <span class="ol-platform-status ready">.dmg, {rolling}</span></a>
          <span class="ol-platform-row" aria-disabled="true">macOS (Intel) <span class="ol-platform-status">{unavailable}</span></span>
          <a href="/download/linux-x86_64" class="ol-platform-row">Linux (Intel/AMD) <span class="ol-platform-status ready">.AppImage, {rolling}</span></a>
          <a href="/download/linux-arm64" class="ol-platform-row">Linux (ARM64) <span class="ol-platform-status ready">.AppImage, {rolling}</span></a>
          <span class="ol-platform-row" aria-disabled="true">Android <span class="ol-platform-status">{unavailable}</span></span>
          <span class="ol-platform-row" aria-disabled="true">iOS <span class="ol-platform-status">{unavailable}</span></span>
          <a href="/download/source" class="ol-platform-row">Source <span class="ol-platform-status">{c['source_status']}</span></a>
        </div>'''


def download_main(c: dict[str, object]) -> str:
    return f'''<main id="main">
  <section class="hero">
    <div class="container">
      <span class="we-are-one">{c['download_kicker']}</span>
      <h1>{c['download_h1']}</h1>
      <p class="lede">{c['download_lede']}</p>
      <div class="cta-row">
        <a href="#platforms" class="btn btn-primary btn-large">{c['choose']} <span class="arr" aria-hidden="true">&rarr;</span></a>
        <a href="https://github.com/coherence-energy-labs/one-link/releases/tag/auto-latest" class="btn btn-ghost" rel="noopener external">{c['github_cta']}</a>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="container">
      <h2>{c['choose']}</h2>
      {platform_rows(c)}
      <p class="ol-attest-dim">{c['availability']}</p>
    </div>
  </section>
  <section class="section">
    <div class="container">
      <span class="kicker">{c['proof_h']}</span>
      <h2>{c['proof_h']}</h2>
      <div class="ol-grid ol-grid-3">
        <article class="ol-tile"><h3>{c['hash_h']}</h3><p>{c['hash_p']}</p></article>
        <article class="ol-tile"><h3>{c['sig_h']}</h3><p>{c['sig_p']}</p></article>
        <article class="ol-tile"><h3>{c['repro_h']}</h3><p>{c['repro_p']}</p></article>
      </div>
      <p class="ol-soft-note">{c['warning']}</p>
      <div class="cta-row"><a href="/verify-download/" class="btn btn-primary">{c['verify_cta']}</a></div>
    </div>
  </section>
</main>'''


def verify_main(c: dict[str, object]) -> str:
    return f'''<main id="main">
  <section class="hero ol-pb-sm">
    <div class="container">
      <span class="we-are-one">{c['verify_kicker']}</span>
      <h1>{c['verify_h1']}</h1>
      <p class="lede">{c['verify_lede']}</p>
    </div>
  </section>
  <section class="section-tight">
    <div class="container">
      <label for="ol-verify-file" class="ol-verify-drop" id="ol-verify-drop">
        <p class="ol-verify-drop-headline">{c['drop_head']}</p>
        <p class="ol-verify-drop-sub">{c['drop_sub']}</p>
        <input type="file" id="ol-verify-file" class="ol-visually-hidden">
      </label>
      <div class="ol-verify-result" id="ol-verify-result" role="status" aria-live="polite"></div>
    </div>
  </section>
  <section class="section">
    <div class="container ol-mw-72ch">
      <h2>{c['verify_explain_h']}</h2>
      <p>{c['verify_p1']}</p>
      <p>{c['verify_p2']}</p>
      <p>{c['verify_p3']}</p>
    </div>
  </section>
</main>'''


def release_main(c: dict[str, object]) -> str:
    items = "\n".join(f"        <li>{item}</li>" for item in c["ready_items"])
    return f'''<main id="main">
  <section class="hero">
    <div class="container">
      <span class="we-are-one">{c['release_kicker']}</span>
      <h1>{c['release_h1']}</h1>
      <p class="lede">{c['release_lede']}</p>
      <div class="cta-row">
        <a href="/download/" class="btn btn-primary">{c['downloads_cta']} <span class="arr" aria-hidden="true">&rarr;</span></a>
        <a href="https://github.com/coherence-energy-labs/one-link/releases" class="btn btn-ghost" rel="noopener external">{c['releases_cta']}</a>
      </div>
    </div>
  </section>
  <section class="section">
    <div class="container ol-mw-72ch">
      <h2>{c['current_h']}</h2>
      <p class="lede">{c['current_p']}</p>
      <h2>{c['ready_h']}</h2>
      <ul>
{items}
      </ul>
      <p class="ol-soft-note">{c['release_note']}</p>
    </div>
  </section>
</main>'''


def builder_section(c: dict[str, object]) -> str:
    return f'''<section class="section">
    <div class="container">
      <span class="kicker">{c['builder_kicker']}</span>
      <h2>{c['builder_h']}</h2>
      <p class="lede ol-mw-64ch">{c['builder_p']}</p>
      <div class="ol-private-demo ol-mt">
        <button type="button" id="ol-rebuild-btn" class="btn btn-primary" data-release-attestation="unavailable" disabled aria-disabled="true">{c['builder_button']}</button>
        <pre class="ol-code ol-output-pre" id="ol-rebuild-out">{c['builder_p']}</pre>
      </div>
    </div>
  </section>'''


def security_disclosure_section(c: dict[str, object]) -> str:
    disclosure = c["security_disclosure"]
    if not isinstance(disclosure, dict):
        raise TypeError("security_disclosure must be a dictionary")
    cards = (
        ("security-contact", "contact_heading", "contact"),
        ("security-response", "response_heading", "response"),
        ("security-bounty-cve", "bounty_heading", "bounty"),
        ("security-severity", "severity_heading", "severity"),
        ("security-safe-harbor", "safe_harbor_heading", "safe_harbor"),
        ("security-track-record", "track_heading", "track"),
    )
    rendered_cards = "\n".join(
        "        "
        f'<article class="ol-tile" data-claim-id="{claim_id}">'
        f'<h3>{disclosure[heading_key]}</h3>'
        f'<p>{disclosure[body_key]}</p>'
        "</article>"
        for claim_id, heading_key, body_key in cards
    )
    return f'''<section class="section" data-claim-scope="security-disclosure">
    <div class="container">
      <span class="kicker">{disclosure['kicker']}</span>
      <h2>{disclosure['heading']}</h2>
      <p class="lede">{disclosure['lede']}</p>
      <div class="ol-grid ol-grid-2">
{rendered_cards}
      </div>
    </div>
  </section>'''


def replace_security_disclosure_section(text: str, c: dict[str, object]) -> str:
    matches = 0

    def callback(match: re.Match[str]) -> str:
        nonlocal matches
        block = match.group(0)
        if "mailto:weareone@oneunity.earth" not in block or "/.well-known/security.txt" not in block:
            return block
        matches += 1
        return security_disclosure_section(c)

    result = SECTION_RE.sub(callback, text)
    if matches != 1:
        raise ValueError(f"security disclosure drift: expected 1 section, found {matches}")
    return result


def security_txt() -> str:
    """Render the RFC 9116 contact without inventing staffed-response promises."""

    return '''# One Link security contact
# Format: RFC 9116  (https://www.rfc-editor.org/rfc/rfc9116)
# Companion page: https://weareone-link.org/security/
# Audit register: https://weareone-link.org/audits/

Contact: mailto:weareone@oneunity.earth
Expires: 2027-05-19T00:00:00.000Z
Preferred-Languages: en
Canonical: https://weareone-link.org/.well-known/security.txt
Policy: https://weareone-link.org/security/
Acknowledgments: https://weareone-link.org/audits/

# ----------------------------------------------------------------------
# Reporting path and current operating boundary
# ----------------------------------------------------------------------
# 1. Email weareone@oneunity.earth with subject line "security report".
# 2. This is a contributor-run, best-effort inbox, not a staffed 24/7
#    security operation. Do not send exploit material or third-party
#    personal data until scope and a protected exchange method are agreed.
#    /share/ is a temporary browser-sharing demo, not an authenticated
#    security-report channel.
# 3. Response targets are explicitly non-guaranteed and are not an SLA:
#    acknowledgement within 72 hours, initial triage within 7 calendar
#    days, and consideration of a mutually coordinated 30-to-90-day
#    disclosure window. Impact, capacity, dependencies, reporter needs,
#    and active exploitation can change the sequence or timing.
# 4. No acknowledgement, triage, remediation, CVE, credit, safe-harbor,
#    or disclosure deadline is guaranteed.

# ----------------------------------------------------------------------
# Preliminary severity taxonomy
# ----------------------------------------------------------------------
# CRITICAL  silent decryption of a sealed payload, identity-key recovery,
#           universal pairing bypass, or manifest-signing-key compromise.
# HIGH      targeted peer attack; release supply-chain compromise; ratchet
#           break enabling retroactive decryption of one channel.
# MEDIUM    timing side channel; denial of service; metadata leakage beyond
#           what /transparency/ documents.
# LOW       hardening opportunity or defense-in-depth gap.
# These labels guide intake priority only. They create no response SLA,
# remediation deadline, bounty amount, safe-harbor guarantee, or CVE right.

# ----------------------------------------------------------------------
# CVE status
# ----------------------------------------------------------------------
# One Link does not claim CNA status and cannot assign or guarantee a CVE.
# For an apparently qualifying finding, contributors may help submit
# information to an appropriate CNA or CVE Program intake. Assignment and
# publication remain under those third parties' control.

# ----------------------------------------------------------------------
# Bug-bounty status and target
# ----------------------------------------------------------------------
# There is no funded bug-bounty program and no promise of payment, reward,
# public acknowledgment, or permanent credit. A funded program remains a
# target contingent on published rules, funding, and legally capable
# administration; no launch date is promised.

# ----------------------------------------------------------------------
# Safe-harbor intent and legal boundary
# ----------------------------------------------------------------------
# Contributors intend to welcome good-faith, authorized, proportionate
# research on researchers' own devices and accounts and not to initiate
# claims solely because it is reported responsibly. This intent is
# not a legal guarantee, legal advice, a contract, authorization to access
# other people's data or systems, or a waiver of law. Contributors cannot bind
# hosting providers, users, individual maintainers, rightsholders, law
# enforcement, or other third parties. Do not exfiltrate, modify, or destroy
# others' data or degrade service. Request written authorization when scope
# is uncertain. A formal, versioned, legally reviewed policy is the target.

# ----------------------------------------------------------------------
# Sources
# ----------------------------------------------------------------------
# Daemon:  https://github.com/coherence-energy-labs/one-link
# Website: https://github.com/coherence-energy-labs/one-link-website
'''


def replace_head(text: str, title: str, description: str) -> str:
    text, n = re.subn(r"<title>[\s\S]*?</title>", f"<title>{title}</title>", text, count=1)
    if n != 1:
        raise ValueError("missing title")
    fields = (
        (r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{description}">', True),
        (r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{description}">', False),
        (r'<meta name="twitter:description" content="[^"]*">', f'<meta name="twitter:description" content="{description}">', False),
    )
    for pattern, replacement, required in fields:
        text, n = re.subn(pattern, replacement, text, count=1)
        if required and n != 1:
            raise ValueError(f"missing metadata pattern: {pattern}")
    return text


def replace_title_metadata(text: str, title: str) -> str:
    """Keep the document, Open Graph, and Twitter titles on one truth boundary."""

    fields = (
        (r"<title>[\s\S]*?</title>", f"<title>{title}</title>", True),
        (r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{title}">', False),
        (r'<meta name="twitter:title" content="[^"]*">', f'<meta name="twitter:title" content="{title}">', False),
    )
    for pattern, replacement, required in fields:
        text, count = re.subn(pattern, replacement, text, count=1)
        if required and count != 1:
            raise ValueError(f"missing title metadata pattern: {pattern}")
    return text


def replace_descriptions(text: str, description: str) -> str:
    fields = (
        r'<meta name="description" content="[^"]*">',
        r'<meta property="og:description" content="[^"]*">',
        r'<meta name="twitter:description" content="[^"]*">',
    )
    replacements = (
        f'<meta name="description" content="{description}">',
        f'<meta property="og:description" content="{description}">',
        f'<meta name="twitter:description" content="{description}">',
    )
    for pattern, replacement in zip(fields, replacements, strict=True):
        text = re.sub(pattern, replacement, text, count=1)
    return text


def replace_matching_blocks(text: str, pattern: re.Pattern[str], predicate, replacement: str) -> str:
    def callback(match: re.Match[str]) -> str:
        return replacement if predicate(match.group(0)) else match.group(0)

    return pattern.sub(callback, text)


def replace_indexed_blocks(
    text: str,
    pattern: re.Pattern[str],
    replacements: dict[int, str],
    label: str,
) -> str:
    """Replace stable structural slots and fail if a localized page drifts."""

    matches = list(pattern.finditer(text))
    if replacements and max(replacements) >= len(matches):
        raise ValueError(
            f"{label} structure drift: need index {max(replacements)}, found {len(matches)} blocks"
        )
    index = 0

    def callback(match: re.Match[str]) -> str:
        nonlocal index
        replacement = replacements.get(index, match.group(0))
        index += 1
        return replacement

    result = pattern.sub(callback, text)
    for replacement in replacements.values():
        if replacement not in result:
            raise ValueError(f"missing generated {label} block")
    return result


def replace_article_paragraphs(
    text: str,
    replacements: dict[int, str],
    label: str,
) -> str:
    """Replace the first paragraph inside selected article slots."""

    articles = list(ARTICLE_ANY_RE.finditer(text))
    if replacements and max(replacements) >= len(articles):
        raise ValueError(
            f"{label} article drift: need index {max(replacements)}, found {len(articles)} articles"
        )
    index = 0

    def callback(match: re.Match[str]) -> str:
        nonlocal index
        article = match.group(0)
        if index in replacements:
            body = replacements[index]
            article, count = PARAGRAPH_RE.subn(f"<p>{body}</p>", article, count=1)
            if count != 1:
                raise ValueError(f"{label} article {index} has no paragraph")
        index += 1
        return article

    result = ARTICLE_ANY_RE.sub(callback, text)
    for replacement in replacements.values():
        if replacement not in result:
            raise ValueError(f"missing generated {label} paragraph")
    return result


def replace_first_lede_in_section(text: str, section_index: int, body: str, label: str) -> str:
    sections = list(SECTION_RE.finditer(text))
    if section_index >= len(sections):
        raise ValueError(f"{label} section drift: need {section_index}, found {len(sections)}")
    index = 0

    def callback(match: re.Match[str]) -> str:
        nonlocal index
        section = match.group(0)
        if index == section_index:
            section, count = re.subn(
                r'<p class="lede(?: [^"]*)?">(?:(?!</p>)[\s\S])*</p>',
                f'<p class="lede">{body}</p>',
                section,
                count=1,
            )
            if count != 1:
                raise ValueError(f"{label} section {section_index} has no lede")
        index += 1
        return section

    result = SECTION_RE.sub(callback, text)
    if body not in result:
        raise ValueError(f"missing generated {label} lede")
    return result


def replace_article_heading_and_paragraph(
    text: str,
    predicate,
    heading: str,
    body: str,
    label: str,
) -> str:
    replacement = f'<article class="ol-tile"><h3>{heading}</h3><p>{body}</p></article>'
    result = replace_matching_blocks(text, ARTICLE_RE, predicate, replacement)
    if replacement not in result:
        raise ValueError(f"missing generated {label} article")
    return result


def replace_matching_article_paragraph(
    text: str,
    predicate,
    body: str,
    label: str,
    required: bool = True,
) -> str:
    """Keep the localized heading while replacing one unsafe claim body."""

    def callback(match: re.Match[str]) -> str:
        block = match.group(0)
        if not predicate(block):
            return block
        result, count = PARAGRAPH_RE.subn(f"<p>{body}</p>", block, count=1)
        if count != 1:
            raise ValueError(f"{label} article has no paragraph")
        return result

    result = ARTICLE_RE.sub(callback, text)
    if required and body not in result:
        raise ValueError(f"missing generated {label} paragraph")
    return result


def replace_article_paragraph_by_heading(text: str, heading: str, body: str, label: str) -> str:
    """Replace exactly one named card while retaining its stable technical heading."""

    marker = f"<h3>{heading}</h3>"
    hits = 0

    def callback(match: re.Match[str]) -> str:
        nonlocal hits
        block = match.group(0)
        if marker not in block:
            return block
        hits += 1
        result, count = PARAGRAPH_RE.subn(f"<p>{body}</p>", block, count=1)
        if count != 1:
            raise ValueError(f"{label} article has no paragraph")
        return result

    result = ARTICLE_RE.sub(callback, text)
    if hits != 1:
        raise ValueError(f"{label} article drift: expected 1, found {hits}")
    return result


def mark_article_claim(text: str, heading: str, claim_id: str, label: str) -> str:
    """Attach one stable claim identifier after localized content replacement."""

    marker = f"<h3>{heading}</h3>"
    hits = 0

    def callback(match: re.Match[str]) -> str:
        nonlocal hits
        block = match.group(0)
        if marker not in block:
            return block
        hits += 1

        def opening(open_match: re.Match[str]) -> str:
            attrs = re.sub(r'\sdata-claim-id="[^"]*"', "", open_match.group("attrs"))
            return f'<article{attrs} data-claim-id="{claim_id}">'

        return re.sub(
            r'<article(?P<attrs>[^>]*)>',
            opening,
            block,
            count=1,
        )

    result = ARTICLE_ANY_RE.sub(callback, text)
    if hits != 1:
        raise ValueError(f"{label} marker drift: expected 1, found {hits}")
    return result


def replace_article_content(
    text: str,
    replacements: dict[int, tuple[str | None, str | None]],
    label: str,
) -> str:
    """Replace the first h3 and/or paragraph within selected article indexes."""

    articles = list(ARTICLE_ANY_RE.finditer(text))
    if replacements and max(replacements) >= len(articles):
        raise ValueError(
            f"{label} article drift: need index {max(replacements)}, found {len(articles)} articles"
        )
    index = 0

    def callback(match: re.Match[str]) -> str:
        nonlocal index
        article = match.group(0)
        if index in replacements:
            heading, body = replacements[index]
            if heading is not None:
                article, count = re.subn(
                    r'<h3(?P<attrs>[^>]*)>(?:(?!</h3>)[\s\S])*</h3>',
                    f'<h3>{heading}</h3>',
                    article,
                    count=1,
                )
                if count != 1:
                    raise ValueError(f"{label} article {index} has no heading")
            if body is not None:
                article, count = PARAGRAPH_RE.subn(f'<p>{body}</p>', article, count=1)
                if count != 1:
                    raise ValueError(f"{label} article {index} has no paragraph")
        index += 1
        return article

    result = ARTICLE_ANY_RE.sub(callback, text)
    for heading, body in replacements.values():
        if heading is not None and heading not in result:
            raise ValueError(f"missing generated {label} heading")
        if body is not None and body not in result:
            raise ValueError(f"missing generated {label} paragraph")
    return result


def rewrite_section_heading_and_lede(
    text: str,
    marker: str,
    heading: str,
    body: str,
    label: str,
) -> str:
    """Rewrite one section selected by a stable element id or code marker."""

    hits = 0

    def callback(match: re.Match[str]) -> str:
        nonlocal hits
        block = match.group(0)
        if marker not in block:
            return block
        hits += 1
        block, h_count = H2_RE.subn(f'<h2>{heading}</h2>', block, count=1)
        block, p_count = re.subn(
            r'<p class="lede(?: [^"]*)?">(?:(?!</p>)[\s\S])*</p>',
            f'<p class="lede ol-mw-64ch">{body}</p>',
            block,
            count=1,
        )
        if h_count != 1 or p_count != 1:
            raise ValueError(f"{label} section structure drift")
        return block

    result = SECTION_RE.sub(callback, text)
    if hits != 1:
        raise ValueError(f"{label} section drift: expected 1, found {hits}")
    return result


def replace_review_date(text: str, body: str) -> str:
    """Replace a trailing localized Last reviewed/updated paragraph without faking recency."""

    date_pattern = re.compile(
        r'<p(?P<attrs>[^>]*)>(?P<body>(?:(?!</p>)[\s\S])*?2026-05-(?:16|17|18|19|24)(?:(?!</p>)[\s\S])*)</p>',
        re.MULTILINE,
    )
    matches = list(date_pattern.finditer(text))
    if not matches:
        if body not in text:
            raise ValueError("missing review-date surface")
        return text
    # Only status/footer dates are replaced; dated changelog and audit entries use
    # their own transforms and are never passed here.
    return date_pattern.sub(lambda m: f'<p{m.group("attrs")}>{body}</p>', text)


def release_claim_transform(slug: str, c: dict[str, object]):
    """Return a transform for stale release assertions outside core pages."""

    signed_words = re.compile(r"sign|firm|assin|unterzeich", re.IGNORECASE)
    release_words = re.compile(r"release|vers|veröffentlich", re.IGNORECASE)

    def transform(text: str) -> str:
        if slug == "about":
            def stale_about(block: str) -> bool:
                return bool(signed_words.search(block) and release_words.search(block))

            return replace_matching_blocks(
                text,
                PARAGRAPH_RE,
                stale_about,
                f"<p>{c['release_lede']}</p>",
            )

        if slug == "features":
            def stale_feature(block: str) -> bool:
                lower = block.lower()
                return "ol_confidential" in lower and ("attest" in lower or "atest" in lower)

            replacement = (
                '<article class="ol-tile">'
                f"<h3>{c['repro_h']}</h3><p>{c['repro_p']}</p>"
                "</article>"
            )
            return replace_matching_blocks(text, ARTICLE_RE, stale_feature, replacement)

        if slug == "security":
            text = replace_descriptions(text, str(c["release_desc"]))

            def signs_every_binary(block: str) -> bool:
                lower = block.lower()
                binary = any(word in lower for word in ("binary", "binario", "binaire", "binär", "binário"))
                source_words = ("source", "código", "code", "quell", "sorgente")
                return (
                    binary
                    and bool(signed_words.search(block))
                    and any(word in lower for word in source_words)
                )

            signature_replacement = (
                '<article class="ol-tile">'
                f"<h3>{c['sig_h']}</h3><p>{c['sig_p']}</p>"
                "</article>"
            )
            text = replace_matching_blocks(text, ARTICLE_RE, signs_every_binary, signature_replacement)

            positive_repro = (
                "every release is built",
                "cada versión se construye",
                "chaque version est construite",
                "jede veröffentlichung wird",
                "jede version wird",
                "cada versão é construída",
                "ogni versione è costruita",
            )

            def stale_repro(block: str) -> bool:
                lower = block.lower()
                return any(phrase in lower for phrase in positive_repro)

            repro_replacement = (
                '<article class="ol-tile">'
                f"<h3>{c['repro_h']}</h3><p>{c['repro_p']}</p>"
                "</article>"
            )
            text = replace_matching_blocks(text, ARTICLE_RE, stale_repro, repro_replacement)

            def stale_updater(block: str) -> bool:
                lower = block.lower()
                return "sha256sums" in lower and bool(signed_words.search(block))

            updater = (
                f"<p>{c['hash_p']} {c['sig_p']}</p>"
            )
            return replace_matching_blocks(text, PARAGRAPH_RE, stale_updater, updater)

        if slug == "roadmap":
            def stale_red_team(block: str) -> bool:
                lower = block.lower()
                return "red team" in lower or "red-team" in lower

            replacement = f'<p class="lede">{c["release_lede"]}</p>'
            return replace_matching_blocks(text, PARAGRAPH_RE, stale_red_team, replacement)

        if slug == "changelog":
            text = replace_descriptions(text, str(c["release_desc"]))

            def signed_history(block: str) -> bool:
                lower = block.lower()
                history = any(word in lower for word in ("full history", "historia completa", "historique complet", "vollständige", "histórico completo", "storia completa"))
                return history and bool(signed_words.search(block))

            text = replace_matching_blocks(
                text,
                PARAGRAPH_RE,
                signed_history,
                f'<p class="lede">{c["release_note"]}</p>',
            )

            def stale_attestation_entry(block: str) -> bool:
                lower = block.lower()
                return "windows" in lower and "linux" in lower and ("attest" in lower or "atest" in lower)

            text = replace_matching_blocks(
                text,
                LIST_ITEM_RE,
                stale_attestation_entry,
                f"<li><strong>Correction:</strong> {c['repro_p']}</li>",
            )

            def stale_verifier_entry(block: str) -> bool:
                lower = block.lower()
                return "head /download" in lower and bool(signed_words.search(block))

            return replace_matching_blocks(
                text,
                LIST_ITEM_RE,
                stale_verifier_entry,
                f"<li><strong>Correction:</strong> {c['verify_p2']}</li>",
            )

        return text

    return transform


def extended_surface_transform(slug: str, c: dict[str, str]):
    """Separate website-manifest integrity from application release proof."""

    key_words = (
        "release key", "signing key for releases", "clave de versión", "clave de firma",
        "clé de version", "clé de signature", "versions-schlüssel", "release-schlüssel",
        "signaturschlüssel", "chave de versão", "chave de assinatura",
        "chiave di versione", "chiave di firma",
    )

    def mentions_old_key(block: str) -> bool:
        lower = block.lower()
        return any(word in lower for word in key_words)

    def transform(text: str) -> str:
        if slug == "security":
            def stale_site_manifest(block: str) -> bool:
                lower = block.lower()
                has_manifest = "manifest" in lower or "manifiest" in lower
                return (
                    'data-claim-scope="site-manifest-current-status"' in block
                    or (has_manifest and (
                        "site-manifest" in lower
                        or "website-asset" in lower
                        or "service worker" in lower
                        or ("ol-mw-64ch" in block and "hash" in lower)
                    ))
                )

            text = replace_matching_blocks(
                text,
                PARAGRAPH_RE,
                stale_site_manifest,
                f'<p class="lede ol-mw-64ch" data-claim-scope="site-manifest-current-status">{c["site_manifest"]}</p>',
            )
            if c["site_manifest"] not in text:
                raise ValueError("missing site-manifest truth copy")
            return text

        if slug == "mirror":
            def stale_mirror_script(block: str) -> bool:
                return "/mirror.sh" in block

            def stale_mirror_verify(block: str) -> bool:
                return "/manifest.json" in block

            def stale_mirror_trust(block: str) -> bool:
                lower = block.lower()
                return ("manifest" in lower or "manifiest" in lower) and any(
                    root in lower for root in ("reproduc", "reproduz", "reprodut", "riprodu")
                )

            text = replace_matching_blocks(
                text, PARAGRAPH_RE, stale_mirror_script,
                f'<p class="ol-soft-text" data-claim-scope="stale-manifest-fail-closed">{c["mirror_script"]}</p>',
            )
            text = replace_matching_blocks(
                text, PARAGRAPH_RE, stale_mirror_verify,
                f'<p class="lede" data-claim-scope="stale-manifest-fail-closed">{c["mirror_verify"]}</p>',
            )
            verify_section_hits = 0

            def rewrite_verify_section(match: re.Match[str]) -> str:
                nonlocal verify_section_hits
                block = match.group(0)
                if "scripts/verify-manifest.py" not in block:
                    return block
                verify_section_hits += 1
                block, count = re.subn(
                    r'<p class="lede"[^>]*>(?:(?!</p>)[\s\S])*</p>',
                    f'<p class="lede" data-claim-scope="stale-manifest-fail-closed">{c["mirror_verify"]}</p>',
                    block,
                    count=1,
                )
                if count != 1:
                    raise ValueError("mirror verifier section has no lede")
                return block

            text = SECTION_RE.sub(rewrite_verify_section, text)
            if verify_section_hits != 1:
                raise ValueError(f"mirror verifier section drift: {verify_section_hits}")
            text = replace_matching_blocks(
                text, PARAGRAPH_RE, stale_mirror_trust,
                f'<p data-claim-scope="stale-manifest-fail-closed">{c["mirror_trust"]}</p>',
            )
            text = re.sub(
                r"#\s+manifest signature:[^\n]*\n(?:(?!</pre>)[\s\S])*(?=</pre>)",
                c["mirror_count"],
                text,
                count=1,
            )
            for key in ("mirror_script", "mirror_verify", "mirror_trust", "mirror_count"):
                if c[key] not in text:
                    raise ValueError(f"missing mirror truth copy: {key}")
            return text

        if slug == "transparency":
            def stale_r2(block: str) -> bool:
                return "/download/" in block and "R2" in block

            def stale_release_proof(block: str) -> bool:
                lower = block.lower()
                reproducible = any(
                    root in lower for root in ("reproduc", "reproduz", "reprodut", "riprodu")
                )
                has_manifest = "manifest" in lower or "manifiest" in lower
                return (mentions_old_key(block) or has_manifest) and reproducible

            text = replace_matching_blocks(
                text, PARAGRAPH_RE, stale_r2,
                f'<p>{c["transparency_r2"]}</p>',
            )
            text = replace_matching_blocks(
                text, PARAGRAPH_RE, stale_release_proof,
                f'<p>{c["transparency_source"]}</p>',
            )
            for key in ("transparency_r2", "transparency_source"):
                if c[key] not in text:
                    raise ValueError(f"missing transparency truth copy: {key}")
            return text

        return text

    return transform


def chat_ui_transform(text: str, c: dict[str, object]) -> str:
    """Scope website-presence chat claims without touching bridge behavior."""

    text = re.sub(
        r'(<div class="(?:ol-mesh-ribbon|ol-peer-hint)"[^>]*>(?:(?!</div>)[\s\S])*?<span>)(?:(?!</span>)[\s\S])*(</span>)',
        rf'\1{c["chat_prompt"]}\2',
        text,
        count=1,
    )
    text = re.sub(
        r'(<div class="ol-chat-panel"[^>]*aria-label=")[^"]*(")',
        rf'\1{c["chat_aria"]}\2',
        text,
        count=1,
    )
    text = re.sub(
        r'<div class="ol-chat-foot">(?:(?!</div>)[\s\S])*</div>',
        f'<div class="ol-chat-foot">{c["chat_footer"]}</div>',
        text,
        count=1,
    )
    text = re.sub(
        r'(<span class="ol-status" id="ol-mesh-here" title=")[^"]*(")',
        rf'\1{c["presence_title"]}\2',
        text,
        count=1,
    )
    text = text.replace(
        'aria-label="Open this chat on the live mesh page"',
        'aria-label="Open this chat on the website presence illustration"',
    )
    text = re.sub(
        r'(<a href="#" class="ol-chat-on-mesh-link"[^>]*>)(?:(?!</a>)[\s\S])*(</a>)',
        r'\1see presence view &rarr;\2',
        text,
        count=1,
    )
    return text


def home_surface_transform(text: str, c: dict[str, object], scope: dict[str, str]) -> str:
    # Preserve the recently hardened pairing/session markup; only change the
    # social copy, confidentiality absolute, and anonymity labels.
    home_locale = next(locale for locale, values in SURFACE_COPY.items() if values is c)
    text = replace_descriptions(text, str(c["home_social"]))
    text = re.sub(
        r'(<h1 class="ol-immersive-title" aria-label=")[^"]*(")',
        rf'\1{c["home_aria"]}\2',
        text,
        count=1,
    )
    words = "\n          ".join(
        f'<span class="ol-w ol-d-{70 + i * 8:02d}">{word}</span>'
        for i, word in enumerate(c["home_gradient"])
    )
    text, count = re.subn(
        r'<span class="ol-line ol-line-grad">(?:(?!</h1>)[\s\S])*</span>\s*</h1>',
        f'<span class="ol-line ol-line-grad">\n          {words}\n        </span>\n      </h1>',
        text,
        count=1,
    )
    if count != 1:
        raise ValueError("missing immersive home title")
    text = chat_ui_transform(text, c)
    integrity_title, integrity_label, integrity_status = SITE_INTEGRITY_COPY[home_locale]
    text, integrity_count = re.subn(
        r'<span class="ol-status" id="ol-site-integrity"[^>]*>\s*'
        r'<span class="dot ol-swatch-[^"]+"></span>\s*'
        r'<span>(?:(?!</span>)[\s\S])*</span>\s*'
        r'<span class="number" id="ol-sw-status">(?:(?!</span>)[\s\S])*</span>\s*'
        r'</span>',
        f'<span class="ol-status" id="ol-site-integrity" title="{integrity_title}">\n'
        f'          <span class="dot ol-swatch-amber"></span>\n'
        f'          <span>{integrity_label}</span>\n'
        f'          <span class="number" id="ol-sw-status">{integrity_status}</span>\n'
        f'        </span>',
        text,
        count=1,
    )
    if integrity_count != 1:
        raise ValueError("missing site-integrity status")
    proof_rows = "\n".join(
        f"                <dt>{label}</dt><dd>{value}</dd>"
        for label, value in PAIR_PROOF_ROWS[home_locale]
    )
    text, proof_count = re.subn(
        r'(<details class="ol-proof">(?:(?!</details>)[\s\S])*?<dl>)'
        r'(?:(?!</dl>)[\s\S])*(</dl>)',
        rf'\1\n{proof_rows}\n              \2',
        text,
        count=1,
    )
    if proof_count != 1:
        raise ValueError("missing local pair proof panel")
    text, tab_pair_count = re.subn(
        r'(<a href="#" class="ol-tab-pair-link" id="ol-tab-pair-link">)'
        r'(?:(?!</a>)[\s\S])*(</a>)',
        rf'\1{PAIR_TAB_LABELS[home_locale]}\2',
        text,
        count=1,
    )
    if tab_pair_count != 1:
        raise ValueError("missing two-tab self-test link")
    text, lede_count = re.subn(
        r'<p class="ol-immersive-lede">(?:(?!</p>)[\s\S])*</p>',
        f'<p class="ol-immersive-lede">{c["home_social"]}</p>',
        text,
        count=1,
    )
    if lede_count != 1:
        raise ValueError("missing immersive home lede")

    home_section_index = 0

    def scope_home_section(block: str) -> str:
        nonlocal home_section_index
        index = home_section_index
        home_section_index += 1
        if index == 1:
            block = H2_RE.sub(f'<h2>{scope["capability_h"]}</h2>', block, count=1)
            block = re.sub(
                r'<p class="lede">(?:(?!</p>)[\s\S])*</p>',
                f'<p class="lede">{c["security_hero"]}</p>', block, count=1,
            )
        elif index == 3:
            block = re.sub(
                r'<p class="lede">(?:(?!</p>)[\s\S])*</p>',
                f'<p class="lede">{c["about_covenant"]}</p>', block, count=1,
            )
        return block

    text = SECTION_RE.sub(lambda match: scope_home_section(match.group(0)), text)
    if home_section_index != 4:
        raise ValueError(f"home section drift: expected 4, found {home_section_index}")
    # A number is only truthful after /api/presence returns a validated
    # welcome.  Static HTML therefore renders an indeterminate value; the
    # bridge replaces it after validation or leaves an unavailable state.
    text = re.sub(
        r'(<span class="number" id="ol-node-count">)(?:(?!</span>)[\s\S])*(</span>)',
        r'\1&hellip;\2',
        text,
        count=1,
    )
    for key in ("home_social", "home_aria", "chat_footer", "presence_title", "security_hero", "about_covenant"):
        if str(c[key]) not in text:
            raise ValueError(f"missing home truth copy: {key}")
    return text


DEPENDENCY_HEADINGS = {
    "en": "Current infrastructure dependencies.",
    "es": "Dependencias actuales de infraestructura.",
    "fr": "Dépendances actuelles à l'infrastructure.",
    "de": "Aktuelle Infrastrukturabhängigkeiten.",
    "pt": "Dependências atuais de infraestrutura.",
    "it": "Dipendenze infrastrutturali attuali.",
}

ACCESSIBILITY_SCOPES = {
    "en": "This statement records current intentions and known gaps. It is manually reviewed; it is not a claim of continuous update, complete testing, or full WCAG conformance.",
    "es": "Esta declaración registra intenciones y carencias actuales. Se revisa manualmente; no afirma actualización continua, pruebas completas ni conformidad WCAG total.",
    "fr": "Cette déclaration consigne les intentions et lacunes actuelles. Ses révisions sont manuelles et ponctuelles ; elle ne prétend pas être testée intégralement ni totalement conforme aux WCAG.",
    "de": "Diese Erklärung dokumentiert aktuelle Absichten und bekannte Lücken. Sie wird manuell geprüft und behauptet weder laufende Aktualisierung noch vollständige Tests oder vollständige WCAG-Konformität.",
    "pt": "Esta declaração regista intenções e lacunas atuais. É revista manualmente; não afirma atualização contínua, testes completos ou conformidade WCAG total.",
    "it": "Questa dichiarazione registra intenzioni e lacune attuali. È rivista manualmente; non afferma aggiornamento continuo, test completi o piena conformità WCAG.",
}


# Cross-page labels intentionally live outside SURFACE_COPY: they scope legacy
# headings and explanatory text while the richer capability model above owns
# the feature-specific details.  Keeping these values locale-aware prevents an
# English disclaimer from becoming the only warning on translated surfaces.
CLAIM_SCOPE_COPY = {
    "en": {
        "footer": "Open-source pre-release software for private communication. Built toward community ownership; current services still depend on identifiable maintainers, operators, and infrastructure providers.",
        "tracking": "No first-party analytics or tracking cookies; infrastructure metadata disclosed.",
        "workflow": "This is an intended pre-release workflow, not proof that every step ran merely because this page or an app was opened. Behavior, local identity storage, backups, transport, and recovery depend on the exact client build and its versioned tests.",
        "capability_h": "Current evidence, demonstrations, and capability requirements.",
        "math_h": "Security properties require versioned implementation evidence.",
        "future_h": "Proposed capabilities; not current availability.",
        "update_h": "Experimental update check; publisher authentication pending.",
        "access_h": "Accessibility design targets and known evidence gaps.",
        "access_item": "Design target, not a universal verified guarantee. This repository does not publish a complete route, browser, assistive-technology, contrast, motion, and touch test matrix proving this item across every surface.",
        "audit_h": "Selected reviews and evidence gaps.",
        "audit_internal_h": "Selected contributor notes; not an independent audit.",
        "audit_evidence_h": "Evidence pointers; not proof of every claim.",
        "internal_evidence": "Contributor-reported internal evidence only. No independent audit, version-pinned artifact, exact current command transcript, or external reproduction is published here; formal-verification, timing, and fuzz assertions remain requirements pending that evidence.",
        "local_demo": "Local browser/WASM demonstration only. It does not prove released daemon integration, real-device recovery, persistent hardware protection, or every message path. Broader behavior remains a capability requirement until a versioned acceptance test is published.",
        "share_retention_h": "Serialized single-consumer retrieval with alarm cleanup.",
        "mesh_cta": "Opening this page can add a validated website-presence dot. Installing a client does not prove membership in a production relay mesh or strengthen routing; that topology remains a future, version-tested deployment goal.",
        "daemon_h": "Some operations may work without this site; dependencies remain.",
        "relay_h": "Independent relay operation and discovery remain deployment goals.",
        "mirror_h": "Static mirroring preserves pages, not the Worker services.",
        "refresh": "This disclosure is reviewed manually and can become stale. Commit history shows edits but is not an atomic notification, independent timestamp, or reliable signal that the page remains complete.",
        "crypto_current_h": "Website current",
        "crypto_current": "Local WASM buttons exercise named primitives in one browser tab. They are self-tests, not a daemon, transport, deployment, or external audit.",
        "crypto_worker_h": "Worker session endpoint",
        "crypto_worker": "/api/session advertises an ephemeral X25519 public key while ML-KEM-768 is null. The browser performs no ECDH or ML-KEM exchange with the Worker and derives no shared session key.",
        "crypto_design_h": "Daemon/protocol design",
        "crypto_design": "Ratchets, chunk AEAD, SAS pairing, onion routing, threshold recovery, capabilities, routing, and at-rest wrapping require versioned integration and adversarial tests. Listing a crate or primitive does not prove every path uses it.",
        "crypto_roadmap_h": "Roadmap",
        "crypto_roadmap": "Post-quantum network handshakes, multi-hop routing, universal forward secrecy, and always-on at-rest protection remain capability requirements unless a pinned release and acceptance evidence say otherwise.",
    },
    "es": {
        "footer": "Software preliminar de código abierto para comunicación privada. Aspira a propiedad comunitaria; los servicios actuales aún dependen de responsables, operadores y proveedores de infraestructura identificables.",
        "tracking": "Sin analítica propia ni cookies de seguimiento; se divulgan metadatos de infraestructura.",
        "workflow": "Este es un flujo preliminar previsto, no prueba de que cada paso ocurra al abrir esta página o una app. El comportamiento, identidad local, copias, transporte y recuperación dependen de la build exacta y sus pruebas versionadas.",
        "capability_h": "Evidencia actual, demostraciones y requisitos de capacidad.",
        "math_h": "Las propiedades de seguridad requieren evidencia versionada.",
        "future_h": "Capacidades propuestas; no disponibilidad actual.",
        "update_h": "Comprobación experimental; autenticación del editor pendiente.",
        "access_h": "Objetivos de accesibilidad y carencias de evidencia.",
        "access_item": "Objetivo de diseño, no garantía universal verificada. El repositorio no publica una matriz completa de rutas, navegadores, tecnologías de apoyo, contraste, movimiento y tacto que pruebe este punto en toda superficie.",
        "audit_h": "Revisiones seleccionadas y carencias de evidencia.",
        "audit_internal_h": "Notas seleccionadas de contribuidores; no auditoría independiente.",
        "audit_evidence_h": "Punteros de evidencia; no prueba de cada afirmación.",
        "internal_evidence": "Evidencia interna declarada por contribuidores. Aquí no se publica auditoría independiente, artefacto versionado, transcripción exacta del comando actual ni reproducción externa; las afirmaciones formales, temporales y de fuzz siguen pendientes de esa evidencia.",
        "local_demo": "Demostración local de navegador/WASM. No prueba integración del daemon publicado, recuperación real, protección persistente por hardware ni toda ruta de mensajes. El alcance mayor sigue siendo requisito hasta una prueba de aceptación versionada.",
        "share_retention_h": "Recogida serializada para un consumidor y limpieza por alarma.",
        "mesh_cta": "Abrir esta página puede añadir un punto validado de presencia web. Instalar un cliente no demuestra pertenencia a una malla productiva ni refuerza rutas; esa topología sigue siendo un objetivo futuro con pruebas por versión.",
        "daemon_h": "Algunas operaciones pueden funcionar sin el sitio; quedan dependencias.",
        "relay_h": "Operación y descubrimiento independientes siguen siendo objetivos.",
        "mirror_h": "El espejo estático conserva páginas, no servicios Worker.",
        "refresh": "Esta divulgación se revisa manualmente y puede quedar obsoleta. El historial muestra cambios, pero no es notificación atómica, sello independiente ni señal fiable de integridad.",
        "crypto_current_h": "Sitio actual", "crypto_current": "Los botones WASM prueban primitivas nombradas en una pestaña. Son auto-pruebas, no daemon, transporte, despliegue ni auditoría externa.",
        "crypto_worker_h": "Endpoint de sesión Worker", "crypto_worker": "/api/session anuncia X25519 efímero y ML-KEM-768 nulo. El navegador no hace ECDH ni ML-KEM con el Worker y no deriva una clave de sesión compartida.",
        "crypto_design_h": "Diseño de daemon/protocolo", "crypto_design": "Ratchets, AEAD por fragmento, SAS, onion, recuperación, capacidades, rutas y cifrado en reposo requieren integración y pruebas adversarias versionadas. Nombrar un crate no prueba su uso en toda ruta.",
        "crypto_roadmap_h": "Hoja de ruta", "crypto_roadmap": "Handshakes PQ de red, varias rutas, secreto hacia adelante universal y cifrado permanente en reposo son requisitos hasta que una versión fijada y su evidencia indiquen lo contrario.",
    },
    "fr": {
        "footer": "Logiciel libre en préversion pour la communication privée. Conçu vers une gouvernance communautaire ; les services actuels dépendent encore de mainteneurs, opérateurs et fournisseurs identifiables.",
        "tracking": "Aucune analytique interne ni cookie de pistage ; métadonnées d’infrastructure divulguées.",
        "workflow": "Ceci décrit un flux de préversion prévu, pas la preuve que chaque étape s’exécute à l’ouverture de cette page ou d’une application. Comportement, identité locale, sauvegardes, transport et récupération dépendent du build exact et de tests versionnés.",
        "capability_h": "Preuves actuelles, démonstrations et exigences de capacité.",
        "math_h": "Les propriétés de sécurité exigent des preuves versionnées.",
        "future_h": "Capacités proposées ; pas une disponibilité actuelle.",
        "update_h": "Vérification expérimentale ; authentification de l’éditeur en attente.",
        "access_h": "Objectifs d’accessibilité et lacunes de preuve connues.",
        "access_item": "Objectif de conception, pas une garantie universelle vérifiée. Le dépôt ne publie pas de matrice complète routes, navigateurs, technologies d’assistance, contraste, mouvement et toucher prouvant ce point partout.",
        "audit_h": "Revues sélectionnées et lacunes de preuve.",
        "audit_internal_h": "Notes de contributeurs sélectionnées ; pas un audit indépendant.",
        "audit_evidence_h": "Pistes de preuve ; pas la preuve de chaque affirmation.",
        "internal_evidence": "Preuve interne déclarée par les contributeurs uniquement. Aucun audit indépendant, artefact versionné, relevé exact de commande actuelle ni reproduction externe n’est publié ici ; vérification formelle, mesures temporelles et fuzz restent à étayer.",
        "local_demo": "Démonstration locale navigateur/WASM uniquement. Elle ne prouve ni intégration du daemon publié, ni récupération réelle, ni protection matérielle persistante, ni chaque chemin de message. Le reste demeure une exigence en attente d’un test d’acceptation versionné.",
        "share_retention_h": "Récupération sérialisée pour un consommateur et nettoyage par alarme.",
        "mesh_cta": "Ouvrir cette page peut ajouter un point de présence web validé. Installer un client ne prouve pas l’appartenance à un maillage de relais en production ni le renforcement du routage ; cette topologie reste un objectif futur testé par version.",
        "daemon_h": "Certaines opérations peuvent fonctionner sans le site ; des dépendances restent.",
        "relay_h": "Relais indépendants et découverte restent des objectifs de déploiement.",
        "mirror_h": "Le miroir statique conserve les pages, pas les services Worker.",
        "refresh": "Cette divulgation est revue manuellement et peut devenir obsolète. L’historique montre des modifications, sans être une notification atomique, un horodatage indépendant ni un signal fiable d’exhaustivité.",
        "crypto_current_h": "Site actuel", "crypto_current": "Les boutons WASM exercent des primitives nommées dans un onglet. Ce sont des auto-tests, pas un daemon, un transport, un déploiement ou un audit externe.",
        "crypto_worker_h": "Endpoint de session Worker", "crypto_worker": "/api/session annonce X25519 éphémère et ML-KEM-768 nul. Le navigateur ne réalise ni ECDH ni ML-KEM avec le Worker et ne dérive aucune clé de session partagée.",
        "crypto_design_h": "Conception daemon/protocole", "crypto_design": "Ratchets, AEAD par fragment, SAS, onion, récupération, capacités, routage et chiffrement au repos exigent intégration et tests adverses versionnés. Nommer une crate ne prouve pas son usage partout.",
        "crypto_roadmap_h": "Feuille de route", "crypto_roadmap": "Handshakes réseau PQ, routage multi-sauts, secret futur universel et protection permanente au repos restent des exigences jusqu’à preuve d’une version épinglée.",
    },
    "de": {
        "footer": "Quelloffene Vorabsoftware für private Kommunikation. Auf gemeinschaftliche Trägerschaft ausgerichtet; heutige Dienste hängen noch von identifizierbaren Betreuern, Betreibern und Infrastrukturprovidern ab.",
        "tracking": "Keine eigene Analyse oder Tracking-Cookies; Infrastrukturmetadaten sind offengelegt.",
        "workflow": "Dies ist ein vorgesehener Vorabablauf, kein Beleg, dass jeder Schritt beim Öffnen dieser Seite oder App erfolgte. Verhalten, lokale Identität, Sicherungen, Transport und Wiederherstellung hängen vom exakten Build und versionierten Tests ab.",
        "capability_h": "Aktuelle Nachweise, Demos und Fähigkeitsanforderungen.",
        "math_h": "Sicherheitseigenschaften brauchen versionierte Nachweise.",
        "future_h": "Vorgeschlagene Fähigkeiten; nicht aktuell verfügbar.",
        "update_h": "Experimentelle Update-Prüfung; Herausgeberauthentisierung ausstehend.",
        "access_h": "Barrierefreiheitsziele und bekannte Nachweislücken.",
        "access_item": "Gestaltungsziel, keine universell geprüfte Garantie. Das Repository veröffentlicht keine vollständige Matrix aus Routen, Browsern, Hilfstechnologien, Kontrast, Bewegung und Touch, die diesen Punkt überall belegt.",
        "audit_h": "Ausgewählte Prüfungen und Nachweislücken.",
        "audit_internal_h": "Ausgewählte Beitragsnotizen; kein unabhängiges Audit.",
        "audit_evidence_h": "Nachweisverweise; kein Beleg jeder Aussage.",
        "internal_evidence": "Nur von Beitragenden gemeldete interne Evidenz. Hier fehlen unabhängiges Audit, versioniertes Artefakt, exaktes aktuelles Befehlsprotokoll und externe Reproduktion; formale, Timing- und Fuzz-Aussagen bleiben bis dahin Anforderungen.",
        "local_demo": "Nur lokale Browser/WASM-Demo. Sie belegt weder Integration im veröffentlichten Daemon noch reale Wiederherstellung, dauerhaften Hardwareschutz oder jeden Nachrichtenpfad. Größerer Umfang bleibt bis zu versionierten Akzeptanztests eine Anforderung.",
        "share_retention_h": "Serialisierter Einmalabruf mit Alarmbereinigung.",
        "mesh_cta": "Das Öffnen dieser Seite kann einen validierten Website-Präsenzpunkt hinzufügen. Eine Client-Installation belegt weder Mitgliedschaft in einem Produktions-Relay-Mesh noch bessere Routen; diese Topologie bleibt ein künftiges, versionsgeprüftes Ziel.",
        "daemon_h": "Einige Vorgänge können ohne die Site laufen; Abhängigkeiten bleiben.",
        "relay_h": "Unabhängiger Relay-Betrieb und Erkennung bleiben Bereitstellungsziele.",
        "mirror_h": "Statische Spiegel erhalten Seiten, nicht die Worker-Dienste.",
        "refresh": "Diese Offenlegung wird manuell geprüft und kann veralten. Der Verlauf zeigt Änderungen, ist aber keine atomare Meldung, unabhängiger Zeitstempel oder verlässliches Vollständigkeitssignal.",
        "crypto_current_h": "Website aktuell", "crypto_current": "Lokale WASM-Schaltflächen üben benannte Primitive in einem Tab. Das sind Selbsttests, kein Daemon, Transport, Deployment oder externes Audit.",
        "crypto_worker_h": "Worker-Sitzungsendpoint", "crypto_worker": "/api/session meldet flüchtiges X25519 und null für ML-KEM-768. Der Browser führt mit dem Worker weder ECDH noch ML-KEM aus und leitet keinen gemeinsamen Sitzungsschlüssel ab.",
        "crypto_design_h": "Daemon-/Protokolldesign", "crypto_design": "Ratchets, Chunk-AEAD, SAS, Onion-Routing, Wiederherstellung, Fähigkeiten, Routing und Ruheverschlüsselung brauchen versionierte Integration und Angriffstests. Ein Crate-Name belegt keinen Einsatz auf allen Pfaden.",
        "crypto_roadmap_h": "Roadmap", "crypto_roadmap": "PQ-Netzwerkhandshakes, Multi-Hop-Routing, universelle Vorwärtsgeheimhaltung und stets aktive Ruheverschlüsselung bleiben Anforderungen bis zum Nachweis eines gepinnten Releases.",
    },
    "pt": {
        "footer": "Software preliminar de código aberto para comunicação privada. Construído rumo à propriedade comunitária; os serviços atuais ainda dependem de mantenedores, operadores e fornecedores identificáveis.",
        "tracking": "Sem analítica própria nem cookies de rastreio; metadados de infraestrutura divulgados.",
        "workflow": "Este é um fluxo preliminar pretendido, não prova de que cada passo ocorreu ao abrir esta página ou aplicação. Comportamento, identidade local, cópias, transporte e recuperação dependem da build exata e de testes versionados.",
        "capability_h": "Evidência atual, demonstrações e requisitos de capacidade.",
        "math_h": "Propriedades de segurança exigem evidência versionada.",
        "future_h": "Capacidades propostas; não disponibilidade atual.",
        "update_h": "Verificação experimental; autenticação do editor pendente.",
        "access_h": "Objetivos de acessibilidade e lacunas de evidência.",
        "access_item": "Objetivo de design, não garantia universal verificada. O repositório não publica uma matriz completa de rotas, browsers, tecnologias assistivas, contraste, movimento e toque que prove este item em todas as superfícies.",
        "audit_h": "Revisões selecionadas e lacunas de evidência.",
        "audit_internal_h": "Notas selecionadas de contribuidores; não auditoria independente.",
        "audit_evidence_h": "Referências de evidência; não prova de cada afirmação.",
        "internal_evidence": "Apenas evidência interna declarada por contribuidores. Não se publica aqui auditoria independente, artefacto versionado, transcrição exata do comando atual ou reprodução externa; afirmações formais, temporais e de fuzz aguardam essa evidência.",
        "local_demo": "Apenas demonstração local no browser/WASM. Não prova integração do daemon publicado, recuperação real, proteção persistente por hardware ou todas as rotas de mensagens. O âmbito maior continua requisito até um teste de aceitação versionado.",
        "share_retention_h": "Recolha serializada por um consumidor e limpeza por alarme.",
        "mesh_cta": "Abrir esta página pode adicionar um ponto validado de presença web. Instalar um cliente não prova participação numa malha de produção nem reforço de rotas; essa topologia permanece um objetivo futuro testado por versão.",
        "daemon_h": "Algumas operações podem funcionar sem o site; restam dependências.",
        "relay_h": "Operação e descoberta independentes continuam objetivos.",
        "mirror_h": "O espelho estático preserva páginas, não serviços Worker.",
        "refresh": "Esta divulgação é revista manualmente e pode ficar obsoleta. O histórico mostra alterações, mas não é notificação atómica, selo independente ou sinal fiável de completude.",
        "crypto_current_h": "Site atual", "crypto_current": "Botões WASM exercitam primitivas nomeadas num separador. São autotestes, não daemon, transporte, deployment ou auditoria externa.",
        "crypto_worker_h": "Endpoint de sessão Worker", "crypto_worker": "/api/session anuncia X25519 efémero e ML-KEM-768 nulo. O browser não faz ECDH nem ML-KEM com o Worker e não deriva chave partilhada.",
        "crypto_design_h": "Design de daemon/protocolo", "crypto_design": "Ratchets, AEAD por bloco, SAS, onion, recuperação, capacidades, rotas e cifra em repouso exigem integração e testes adversários versionados. Nomear uma crate não prova uso em todos os caminhos.",
        "crypto_roadmap_h": "Roteiro", "crypto_roadmap": "Handshakes PQ de rede, múltiplos saltos, segredo futuro universal e proteção permanente em repouso continuam requisitos até prova de uma versão fixada.",
    },
    "it": {
        "footer": "Software open source preliminare per comunicazioni private. Costruito verso la proprietà comunitaria; i servizi attuali dipendono ancora da manutentori, operatori e fornitori identificabili.",
        "tracking": "Nessuna analitica propria né cookie di tracciamento; metadati infrastrutturali dichiarati.",
        "workflow": "Questo è un flusso preliminare previsto, non la prova che ogni passo avvenga aprendo questa pagina o un’app. Comportamento, identità locale, backup, trasporto e recupero dipendono dalla build esatta e da test versionati.",
        "capability_h": "Evidenza attuale, dimostrazioni e requisiti di capacità.",
        "math_h": "Le proprietà di sicurezza richiedono evidenza versionata.",
        "future_h": "Capacità proposte; non disponibilità attuale.",
        "update_h": "Controllo sperimentale; autenticazione dell’editore in attesa.",
        "access_h": "Obiettivi di accessibilità e lacune di evidenza note.",
        "access_item": "Obiettivo di design, non garanzia universale verificata. Il repository non pubblica una matrice completa di route, browser, tecnologie assistive, contrasto, movimento e tocco che provi questo elemento ovunque.",
        "audit_h": "Revisioni selezionate e lacune di evidenza.",
        "audit_internal_h": "Note selezionate dei contributori; non audit indipendente.",
        "audit_evidence_h": "Riferimenti di evidenza; non prova di ogni affermazione.",
        "internal_evidence": "Solo evidenza interna dichiarata dai contributori. Qui non sono pubblicati audit indipendente, artefatto versionato, trascrizione esatta del comando attuale o riproduzione esterna; le affermazioni formali, temporali e fuzz attendono tale evidenza.",
        "local_demo": "Solo dimostrazione locale browser/WASM. Non prova integrazione nel daemon rilasciato, recupero reale, protezione hardware persistente o ogni percorso dei messaggi. L’ambito più ampio resta requisito fino a un test di accettazione versionato.",
        "share_retention_h": "Recupero serializzato per un consumatore e pulizia tramite allarme.",
        "mesh_cta": "Aprire questa pagina può aggiungere un punto validato di presenza web. Installare un client non prova appartenenza a una mesh di produzione né rafforza il routing; tale topologia resta un obiettivo futuro testato per versione.",
        "daemon_h": "Alcune operazioni possono funzionare senza il sito; restano dipendenze.",
        "relay_h": "Gestione e scoperta indipendenti dei relay restano obiettivi.",
        "mirror_h": "Il mirror statico conserva pagine, non i servizi Worker.",
        "refresh": "Questa informativa è rivista manualmente e può diventare obsoleta. La cronologia mostra modifiche, ma non è notifica atomica, timestamp indipendente o segnale affidabile di completezza.",
        "crypto_current_h": "Sito attuale", "crypto_current": "I pulsanti WASM esercitano primitive nominate in una scheda. Sono autotest, non daemon, trasporto, deployment o audit esterno.",
        "crypto_worker_h": "Endpoint sessione Worker", "crypto_worker": "/api/session annuncia X25519 effimero e ML-KEM-768 nullo. Il browser non esegue ECDH o ML-KEM col Worker e non deriva una chiave condivisa.",
        "crypto_design_h": "Design daemon/protocollo", "crypto_design": "Ratchet, AEAD per blocco, SAS, onion, recupero, capacità, routing e cifratura a riposo richiedono integrazione e test avversari versionati. Nominare una crate non prova l’uso in ogni percorso.",
        "crypto_roadmap_h": "Roadmap", "crypto_roadmap": "Handshake PQ di rete, routing multi-hop, forward secrecy universale e protezione continua a riposo restano requisiti finché una release fissata non li prova.",
    },
}

PRESENCE_LINK_LABELS = {
    "en": "Website presence", "es": "Presencia web", "fr": "Présence web",
    "de": "Website-Präsenz", "pt": "Presença web", "it": "Presenza web",
}
MESH_PAGE_TITLES = {
    "en": "Website presence illustration - One Link",
    "es": "Ilustración de presencia web - One Link",
    "fr": "Illustration de présence web - One Link",
    "de": "Website-Präsenzdarstellung - One Link",
    "pt": "Ilustração de presença web - One Link",
    "it": "Illustrazione della presenza web - One Link",
}
SITE_INTEGRITY_COPY = {
    "en": ("The checked-in signed site manifest is stale after current changes. Service-worker integrity preflight must fail until a fresh offline-signed manifest matches every tracked asset.", "site integrity", "manifest stale"),
    "es": ("El manifiesto web firmado incluido está desactualizado. La precomprobación del Service Worker debe fallar hasta que un manifiesto nuevo firmado offline coincida con todos los activos.", "integridad web", "manifiesto obsoleto"),
    "fr": ("Le manifeste web signé inclus est périmé. Le précontrôle du Service Worker doit échouer jusqu’à ce qu’un nouveau manifeste signé hors ligne corresponde à tous les assets.", "intégrité du site", "manifeste périmé"),
    "de": ("Das enthaltene signierte Website-Manifest ist veraltet. Die Service-Worker-Vorprüfung muss fehlschlagen, bis ein neues offline signiertes Manifest zu allen Assets passt.", "Website-Integrität", "Manifest veraltet"),
    "pt": ("O manifesto web assinado incluído está desatualizado. A pré-verificação do Service Worker deve falhar até um novo manifesto assinado offline coincidir com todos os ativos.", "integridade do site", "manifesto desatualizado"),
    "it": ("Il manifest web firmato incluso è obsoleto. Il precontrollo del Service Worker deve fallire finché un nuovo manifest firmato offline non corrisponde a tutti gli asset.", "integrità del sito", "manifest obsoleto"),
}
PAIR_PROOF_ROWS = {
    "en": [
        ("scope", "Local one-tab Inviter/Scanner wrapper self-test; no phone, camera, daemon, or network transport."),
        ("key agreement", "Ephemeral X25519 in the current ol_pair_qr path; no ML-KEM is used by this pairing wrapper."),
        ("signatures", "Fresh local Ed25519 keys sign the pairing frames; no ML-DSA signature is produced here."),
        ("SAS + key", "A five-word, 30-bit transcript SAS and a 32-byte chain key are derived and compared locally."),
        ("not included", "No environmental field witness, durable identity, second-device proof, or human out-of-band comparison."),
    ],
    "es": [
        ("alcance", "Autoprueba local en una pestaña con Inviter/Scanner; sin móvil, cámara, daemon ni transporte de red."),
        ("acuerdo", "X25519 efímero en la ruta actual de ol_pair_qr; este wrapper de emparejamiento no usa ML-KEM."),
        ("firmas", "Claves Ed25519 locales nuevas firman los frames; aquí no se produce firma ML-DSA."),
        ("SAS y clave", "Se derivan y comparan localmente un SAS de cinco palabras y 30 bits y una clave de cadena de 32 bytes."),
        ("no incluido", "Sin testigo de campo ambiental, identidad duradera, prueba de segundo dispositivo ni comparación humana externa."),
    ],
    "fr": [
        ("portée", "Auto-test local Inviter/Scanner dans un onglet ; aucun téléphone, appareil photo, démon ou transport réseau."),
        ("accord", "X25519 éphémère dans le chemin ol_pair_qr actuel ; ce wrapper d’association n’utilise pas ML-KEM."),
        ("signatures", "De nouvelles clés Ed25519 locales signent les trames ; aucune signature ML-DSA n’est produite ici."),
        ("SAS et clé", "Un SAS de cinq mots sur 30 bits et une clé de chaîne de 32 octets sont dérivés et comparés localement."),
        ("absent", "Aucun témoin de champ, identité durable, second appareil ni comparaison humaine hors bande."),
    ],
    "de": [
        ("Umfang", "Lokaler Inviter/Scanner-Selbsttest in einem Tab; kein Telefon, keine Kamera, kein Daemon und kein Netztransport."),
        ("Schlüsselaustausch", "Flüchtiges X25519 im aktuellen ol_pair_qr-Pfad; dieser Kopplungs-Wrapper verwendet kein ML-KEM."),
        ("Signaturen", "Neue lokale Ed25519-Schlüssel signieren die Frames; hier entsteht keine ML-DSA-Signatur."),
        ("SAS und Schlüssel", "Ein Fünfwort-SAS mit 30 Bit und ein 32-Byte-Kettenschlüssel werden lokal abgeleitet und verglichen."),
        ("nicht enthalten", "Kein Feldzeuge, keine dauerhafte Identität, kein Zweitgerätenachweis und kein menschlicher externer Vergleich."),
    ],
    "pt": [
        ("âmbito", "Autoteste local Inviter/Scanner num separador; sem telefone, câmara, daemon ou transporte de rede."),
        ("acordo", "X25519 efémero no caminho ol_pair_qr atual; este wrapper de emparelhamento não usa ML-KEM."),
        ("assinaturas", "Novas chaves Ed25519 locais assinam os frames; aqui não é produzida assinatura ML-DSA."),
        ("SAS e chave", "Um SAS de cinco palavras e 30 bits e uma chave de cadeia de 32 bytes são derivados e comparados localmente."),
        ("não incluído", "Sem testemunha de campo, identidade duradoura, prova de segundo dispositivo ou comparação humana externa."),
    ],
    "it": [
        ("ambito", "Autotest locale Inviter/Scanner in una scheda; nessun telefono, fotocamera, daemon o trasporto di rete."),
        ("accordo", "X25519 effimero nel percorso ol_pair_qr attuale; questo wrapper di pairing non usa ML-KEM."),
        ("firme", "Nuove chiavi Ed25519 locali firmano i frame; qui non viene prodotta alcuna firma ML-DSA."),
        ("SAS e chiave", "Un SAS di cinque parole e 30 bit e una chain key di 32 byte vengono derivati e confrontati localmente."),
        ("non incluso", "Nessun testimone di campo, identità durevole, prova di secondo dispositivo o confronto umano esterno."),
    ],
}
PAIR_TAB_LABELS = {
    "en": "run a local second-tab transport self-test &rarr;",
    "es": "ejecutar una autoprueba local de transporte en otra pestaña &rarr;",
    "fr": "lancer un auto-test local de transport dans un second onglet &rarr;",
    "de": "lokalen Transport-Selbsttest in zweitem Tab starten &rarr;",
    "pt": "executar autoteste local de transporte noutro separador &rarr;",
    "it": "esegui un autotest locale di trasporto in una seconda scheda &rarr;",
}


TRACKING_ABSOLUTE_RE = re.compile(
    r'(<a href="/security/"[^>]*>)(?:No tracking|Sin seguimiento|Sin rastreo|'
    r'Sans suivi|Pas de pistage|Kein Tracking|Sem rastreamento|Nessun tracciamento)\.(</a>)',
    re.IGNORECASE,
)


def global_surface_transform(text: str, locale: str) -> str:
    """Apply disclosures shared by every generated HTML surface."""

    scope = CLAIM_SCOPE_COPY[locale]
    text, footer_count = re.subn(
        r'<p class="footer-tag">(?:(?!</p>)[\s\S])*</p>',
        f'<p class="footer-tag">{scope["footer"]}</p>',
        text,
        count=1,
    )
    if footer_count != 1:
        raise ValueError(f"missing {locale} footer disclosure")
    text = TRACKING_ABSOLUTE_RE.sub(
        lambda match: f'{match.group(1)}{scope["tracking"]}{match.group(2)}',
        text,
    )
    text = re.sub(
        r'(<a href="/mesh/"[^>]*>)([^<]*)(</a>)',
        lambda match: f'{match.group(1)}{PRESENCE_LINK_LABELS[locale]}{match.group(3)}',
        text,
    )
    # Once generated HTML receives hand-reviewed truth copy, an old .cl build
    # timestamp is no longer honest provenance.  Retain a precise renderer and
    # review marker without pretending the resulting bytes came directly from
    # the historical SSG invocation.
    text = re.sub(
        r'<meta name="x-emitted-by" content="[^"]*">',
        '<meta name="x-truth-rendered-by" content="scripts/apply_release_truth.py">',
        text,
        count=1,
    )
    text = re.sub(
        r'<!-- Route: (?P<route>[^/\r\n]*|/[^\r\n]*?) / build: [^/\r\n]* / source: [^\r\n]* -->',
        '<!-- Release-truth copy reviewed 2026-07-22; historical SSG byte provenance is not asserted. -->',
        text,
        count=1,
    )
    text = re.sub(r'[ \t]+(?=\r?\n)', '', text)
    return text


def capability_surface_transform(locale: str, slug: str, c: dict[str, object]):
    def transform(text: str) -> str:
        scope = CLAIM_SCOPE_COPY[locale]
        if slug == "features":
            text = replace_descriptions(text, str(c["features_desc"]))
            text = replace_indexed_blocks(
                text, H1_RE, {0: f'<h1>{scope["capability_h"]}</h1>'}, "feature capability heading"
            )
            text = replace_matching_blocks(
                text,
                PARAGRAPH_RE,
                lambda block: "/api/status" in block or "/api/capabilities" in block or str(c["features_lede"]) in block,
                f'<p class="lede">{c["features_lede"]}</p>',
            )
            text, count = re.subn(
                r'<span class="ol-status">(?:(?!</span>\s*</span>)[\s\S])*</span>\s*</span>',
                f'<span class="ol-status"><span class="dot"></span><span>{c["features_status"]}</span></span>',
                text,
                count=1,
            )
            if count != 1 and str(c["features_status"]) not in text:
                raise ValueError("missing feature status badge")
            text = replace_article_paragraphs(
                text,
                {
                    1: str(c["features_file"]),
                    2: str(c["features_call"]),
                    4: str(c["features_devices"]),
                    5: str(c["features_account"]),
                    6: str(c["features_crypto"]),
                    7: str(c["features_route"]),
                    8: str(c["features_pq"]),
                },
                "feature matrix",
            )
            feature_residuals = (
                {
                    0: (None, str(c["features_future"])),
                    3: (None, str(c["features_future"])),
                    10: (None, scope["local_demo"]),
                    11: (None, scope["local_demo"]),
                    12: (scope["update_h"], None),
                    14: (None, str(c["about_open"])),
                    16: (None, scope["local_demo"]),
                    17: (None, str(c["features_future"])),
                }
                if locale == "en"
                else {
                    0: (None, str(c["features_future"])),
                    3: (None, str(c["features_future"])),
                    10: (None, scope["local_demo"]),
                    12: (None, str(c["about_open"])),
                    14: (None, scope["local_demo"]),
                    15: (None, str(c["features_future"])),
                }
            )
            text = replace_article_content(text, feature_residuals, "feature residual claims")
            forever_roots = ("forever", "siempre", "toujours", "immer", "sempre")
            text = replace_article_heading_and_paragraph(
                text,
                lambda block: any(root in block.lower() for root in forever_roots),
                str(c["features_free_h"]),
                str(c["features_free"]),
                "free-access boundary",
            )
            text = replace_matching_blocks(
                text,
                PARAGRAPH_RE,
                lambda block: "v0.22" in block and "WASM" in block.upper(),
                f'<p class="lede">{c["features_future"]}</p>',
            )
            text = rewrite_section_heading_and_lede(
                text,
                str(c["features_pq"]),
                scope["math_h"],
                str(c["features_lede"]),
                "feature security evidence",
            )
            text = rewrite_section_heading_and_lede(
                text,
                str(c["features_private"]),
                scope["future_h"],
                str(c["features_future"]),
                "feature roadmap",
            )
            text = replace_matching_article_paragraph(
                text,
                lambda block: "Sphinx" in block and any(
                    root in block.lower() for root in ("three", "tres", "trois", "drei", "três", "tre")
                ),
                str(c["features_private"]),
                "private-routing scope",
            )
            text = replace_matching_article_paragraph(
                text,
                lambda block: (
                    "ONE_LINK_EXPERIMENTAL_AUTOINSTALL" in block
                    or str(scope["update_h"]) in block
                ),
                str(c["features_update"]),
                "feature updater scope",
                required=locale == "en",
            )
            text = replace_review_date(text, "Claims reviewed 2026-07-22.") if locale == "en" else replace_review_date(text, {
                "es": "Afirmaciones revisadas el 2026-07-22.", "fr": "Affirmations revues le 2026-07-22.",
                "de": "Aussagen am 2026-07-22 geprüft.", "pt": "Afirmações revistas em 2026-07-22.",
                "it": "Affermazioni riviste il 2026-07-22.",
            }[locale])
            return text

        if slug == "how-it-works":
            text = replace_descriptions(text, str(c["how_desc"]))
            text = replace_indexed_blocks(
                text, PARAGRAPH_RE, {0: f'<p class="lede">{scope["workflow"]}</p>'}, "workflow scope"
            )
            text = replace_article_paragraphs(
                text,
                {0: scope["workflow"], 1: str(c["how_pair"]), 2: str(c["how_send"]), 3: str(c["how_done"]),
                 4: str(c["how_relay"]), 5: str(c["how_retention"]), 6: str(c["how_failover"])},
                "how-it-works",
            )
            text = replace_first_lede_in_section(text, 2, str(c["how_relay_lede"]), "relay boundary")

            if locale == "en":
                text = rewrite_frozen_update_section(text, c, scope)

            def rewrite_onion(block: str) -> str:
                seen = False

                def paragraph(match: re.Match[str]) -> str:
                    nonlocal seen
                    if seen:
                        return ""
                    seen = True
                    return f'<p class="lede">{c["how_private"]}</p>'

                return PARAGRAPH_RE.sub(paragraph, block)

            private_section_index = (
                4 if f'data-claim-scope="{UPDATE_INSTALL_SCOPE}"' in text else 3
            )
            private_index = 0

            def private_section_callback(match: re.Match[str]) -> str:
                nonlocal private_index
                block = match.group(0)
                result = rewrite_onion(block) if private_index == private_section_index else block
                private_index += 1
                return result

            text = SECTION_RE.sub(private_section_callback, text)
            text = re.sub(
                r'(<pre class="ol-code">)(?=<span class="d">// you tap)',
                r'\1<span class="d">// roadmap pseudocode; not the current website route</span>\n',
                text,
                count=1,
            )

            crypto_dl = (
                '<dl data-claim-scope="cryptographic-stack">'
                f'<dt>{scope["crypto_current_h"]}</dt><dd>{scope["crypto_current"]}</dd>'
                f'<dt>{scope["crypto_worker_h"]}</dt><dd>{scope["crypto_worker"]}</dd>'
                f'<dt>{scope["crypto_design_h"]}</dt><dd>{scope["crypto_design"]}</dd>'
                f'<dt>{scope["crypto_roadmap_h"]}</dt><dd>{scope["crypto_roadmap"]}</dd>'
                '</dl>'
            )
            crypto_hits = 0

            def rewrite_crypto_stack(match: re.Match[str]) -> str:
                nonlocal crypto_hits
                block = match.group(0)
                if not (
                    'data-claim-scope="cryptographic-stack"' in block
                    or ('<details class="ol-proof"' in block and "<dl>" in block)
                ):
                    return block
                crypto_hits += 1
                return re.sub(r'<dl(?: [^>]*)?>(?:(?!</dl>)[\s\S])*</dl>', crypto_dl, block, count=1)

            text = SECTION_RE.sub(rewrite_crypto_stack, text)
            if crypto_hits != 1:
                raise ValueError(f"cryptographic stack drift: expected 1, found {crypto_hits}")
            audit_roots = ("all audited", "todo audit", "toutes audit", "alle audit", "tudo audit", "tutto audit")
            text = replace_matching_blocks(
                text,
                PARAGRAPH_RE,
                lambda block: any(root in block.lower() for root in audit_roots),
                f'<p class="lede">{c["how_audit"]}</p>',
            )
            return text

        if slug == "share":
            text = replace_descriptions(text, str(c["share_desc"]))
            text = replace_indexed_blocks(text, H1_RE, {0: f'<h1>{c["share_h1"]}</h1>'}, "share heading")
            text = replace_indexed_blocks(
                text,
                PARAGRAPH_RE,
                {0: f'<p class="lede">{c["share_desc"]} {c["share_delete"]}</p>'},
                "share sender retention",
            )
            text, recv_count = re.subn(
                r'<p class="lede" id="ol-recv-lede">(?:(?!</p>)[\s\S])*</p>',
                f'<p class="lede" id="ol-recv-lede">{c["share_key"]} {c["share_delete"]}</p>',
                text,
                count=1,
            )
            if recv_count != 1:
                raise ValueError("missing share receiver retention disclosure")
            text, count = re.subn(
                r'<p class="ol-soft-text ol-mw-56ch">(?:(?!</p>)[\s\S])*</p>',
                f'<p class="ol-soft-text ol-mw-56ch">{c["share_app"]}</p>',
                text,
                count=1,
            )
            if count != 1:
                raise ValueError("missing share app limitation")
            text = replace_article_paragraphs(
                text, {1: str(c["share_key"]), 2: str(c["share_delete"])}, "share explanation"
            )
            text = replace_article_content(
                text, {2: (scope["share_retention_h"], None)}, "share retention heading"
            )
            text, count = re.subn(
                r'<p class="ol-mw-mono-small">(?:(?!</p>)[\s\S])*</p>',
                f'<p class="ol-mw-mono-small">{c["share_app"]}</p>',
                text,
                count=1,
            )
            if count != 1:
                raise ValueError("missing share native-client boundary")
            return text

        if slug == "privacy":
            text = replace_title_metadata(text, str(c["privacy_title"]))
            text = replace_descriptions(text, str(c["privacy_desc"]))
            text = replace_indexed_blocks(text, H1_RE, {0: f'<h1>{c["privacy_h1"]}</h1>'}, "privacy heading")
            text = replace_indexed_blocks(
                text,
                PARAGRAPH_RE,
                {
                    0: f'<p class="ol-prose">{c["privacy_noaccount"]}</p>',
                    1: f'<p class="ol-prose">{c["privacy_edge"]}</p>',
                    2: f'<p class="ol-prose">{c["privacy_request"]}</p>',
                },
                "privacy inventory",
            )
            items = "".join(f"<li>{item}</li>" for item in c["privacy_list"])
            text, count = UL_PROSE_RE.subn(f'<ul class="ol-list-prose">{items}</ul>', text, count=1)
            if count != 1:
                raise ValueError("missing privacy list")
            reviewed = {
                "en": "Privacy inventory reviewed 2026-07-22.", "es": "Inventario de privacidad revisado el 2026-07-22.",
                "fr": "Inventaire de confidentialité revu le 2026-07-22.", "de": "Datenschutzinventar am 2026-07-22 geprüft.",
                "pt": "Inventário de privacidade revisto em 2026-07-22.", "it": "Inventario privacy rivisto il 2026-07-22.",
            }
            return replace_review_date(text, reviewed[locale])

        if slug == "security":
            text = replace_descriptions(text, str(c["security_desc"]))
            text = replace_indexed_blocks(
                text,
                PARAGRAPH_RE,
                {
                    0: f'<p class="lede">{c["security_hero"]}</p>',
                    1: f'<p class="lede ol-mb-sm">{c["security_collect_h"]}</p>',
                    2: f'<p class="ol-soft-text ol-mw-56ch">{c["security_collect"]}</p>',
                    3: f'<p class="ol-soft-text ol-mw-56ch">{c["security_request"]}</p>',
                },
                "security boundary",
            )
            text = replace_article_paragraphs(
                text,
                {0: str(c["security_wire"]), 1: str(c["security_pair"]),
                 2: str(c["security_server"]), 3: str(c["security_traffic"])},
                "security attack model",
            )
            security_residuals = {
                4: (None, scope["local_demo"]),
                5: (None, scope["local_demo"]),
                8: (None, f'{c["features_crypto"]} {c["mesh_ids"]}'),
                9: (None, str(c["security_traffic"])),
                10: (None, scope["internal_evidence"]),
                11: (None, scope["internal_evidence"]),
                12: (None, scope["internal_evidence"]),
            }
            if locale == "en":
                security_residuals.update({
                    14: (scope["update_h"], None),
                    21: (None, str(c["audits_lede"])),
                })
            else:
                security_residuals[19] = (None, str(c["audits_lede"]))
            text = replace_article_content(text, security_residuals, "security residual claims")
            text = replace_indexed_blocks(
                text,
                H2_RE,
                {1: f'<h2>{scope["capability_h"]}</h2>',
                 3: f'<h2>{scope["audit_evidence_h"]}</h2>'},
                "security section claims",
            )
            text = rewrite_section_heading_and_lede(
                text, 'id="ol-pqsig-btn"', scope["capability_h"], scope["local_demo"],
                "hybrid-signature demonstration",
            )
            text = rewrite_section_heading_and_lede(
                text, 'id="ol-ratchet-btn"', scope["capability_h"], scope["local_demo"],
                "ratchet demonstration",
            )
            text = rewrite_section_heading_and_lede(
                text, 'id="ol-hwkey-btn"', scope["capability_h"], scope["local_demo"],
                "device-recognition demonstration",
            )
            text = replace_matching_article_paragraph(
                text,
                lambda block: "Verified updates" in block or "hash-gated" in block.lower(),
                str(c["security_update"]),
                "security updater scope",
                required=locale == "en",
            )
            text = replace_matching_article_paragraph(
                text,
                lambda block: "verify-this-install" in block,
                str(c["security_install"]),
                "install fingerprint scope",
                required=locale == "en",
            )
            return replace_security_disclosure_section(text, c)

        if slug == "transparency":
            text = replace_indexed_blocks(
                text, PARAGRAPH_RE,
                {0: f'<p class="lede">{c["transparency_daemon"]}</p>'},
                "transparency introduction",
            )
            text = replace_indexed_blocks(
                text, H2_RE,
                {0: f'<h2>{c["transparency_status_h"]}</h2>',
                 3: f'<h2>{DEPENDENCY_HEADINGS[locale]}</h2>',
                 4: f'<h2>{c["transparency_refresh_h"]}</h2>'},
                "transparency headings",
            )
            text = replace_indexed_blocks(
                text,
                PARAGRAPH_RE,
                {1: f'<p>{c["transparency_status"][0]}</p>',
                 2: f'<p>{c["transparency_status"][1]}</p>',
                 3: f'<p>{c["transparency_status"][2]}</p>'},
                "transparency status",
            )
            text, count = re.subn(
                r'<pre class="ol-code">(?:(?!</pre>)[\s\S])*</pre>',
                '<pre class="ol-code">status: contributor disclosure\nexternal_signature: not-published\nprevious_canary: expired</pre>',
                text,
                count=1,
            )
            if count != 1:
                raise ValueError("missing expired transparency canary")
            text = replace_article_paragraphs(
                text,
                {0: str(c["transparency_content"]), 1: str(c["transparency_social"]),
                 2: str(c["transparency_social"]), 3: str(c["transparency_relays"]),
                 4: str(c["transparency_location"]), 7: str(c["transparency_mesh"]),
                 8: str(c["transparency_native"]), 9: str(c["transparency_rate"]),
                 12: str(c["transparency_daemon"]), 13: str(c["transparency_relays"])},
                "transparency inventory",
            )
            text = replace_article_content(
                text,
                {
                    5: (None, str(c["features_free"])),
                    11: (None, f'{c["privacy_noaccount"]} {c["privacy_edge"]}'),
                    12: (scope["daemon_h"], None),
                    13: (scope["relay_h"], None),
                    14: (scope["mirror_h"], str(c["transparency_close"])),
                },
                "transparency residual claims",
            )

            def rewrite_dependency_section(block: str) -> str:
                updated, dependency_count = PARAGRAPH_RE.subn(
                    f'<p class="lede">{c["transparency_daemon"]}</p>',
                    block,
                    count=1,
                )
                if dependency_count != 1:
                    raise ValueError("missing transparency dependency lede")
                return updated

            dependency_count = 0

            def dependency_callback(match: re.Match[str]) -> str:
                nonlocal dependency_count
                block = match.group(0)
                if DEPENDENCY_HEADINGS[locale] not in block:
                    return block
                dependency_count += 1
                return rewrite_dependency_section(block)

            text = SECTION_RE.sub(dependency_callback, text)
            if dependency_count != 1:
                raise ValueError("missing unique transparency dependency section")
            text, count = re.subn(
                r'<p class="ol-mt-md ol-prose">(?:(?!</p>)[\s\S])*</p>',
                f'<p class="ol-mt-md ol-prose">{c["transparency_close"]}</p>',
                text,
                count=1,
            )
            if count != 1:
                raise ValueError("missing transparency dependency close")
            # The closing section must not contradict the earlier warning that
            # commit-history silence is not a reliable signal.
            refresh_hits = 0

            def refresh_callback(match: re.Match[str]) -> str:
                nonlocal refresh_hits
                block = match.group(0)
                if str(c["transparency_refresh_h"]) not in block:
                    return block
                refresh_hits += 1
                return re.sub(
                    r'<p class="lede">(?:(?!</p>)[\s\S])*</p>',
                    f'<p class="lede">{scope["refresh"]}</p>', block, count=1,
                )

            text = SECTION_RE.sub(refresh_callback, text)
            if refresh_hits != 1:
                raise ValueError(f"transparency refresh drift: expected 1, found {refresh_hits}")
            return text

        if slug == "mesh":
            text = replace_head(text, MESH_PAGE_TITLES[locale], str(c["mesh_desc"]))
            text = replace_title_metadata(text, MESH_PAGE_TITLES[locale])
            text = chat_ui_transform(text, c)
            text, kicker_count = re.subn(
                r'<span class="we-are-one">(?:(?!</span>)[\s\S])*</span>',
                f'<span class="we-are-one">{PRESENCE_LINK_LABELS[locale]}</span>',
                text,
                count=1,
            )
            if kicker_count != 1:
                raise ValueError("missing mesh presence kicker")
            text = re.sub(
                r'(<[^>]+id="(?:ol-hero-count|ol-mesh-count|ol-mesh-nodes|ol-node-count)"[^>]*>)(?:(?!</[^>]+>)[\s\S])*?(</[^>]+>)',
                r'\1&hellip;\2',
                text,
            )
            text = re.sub(
                r'(<[^>]+id="ol-mesh-relays"[^>]*>)(?:(?!</[^>]+>)[\s\S])*?(</[^>]+>)',
                r'\1&mdash;\2', text,
            )
            text = re.sub(
                r'(<canvas class="ol-mesh-canvas"[^>]*aria-label=")[^"]*(")',
                r'\1Website-presence illustration; not live routing telemetry\2', text, count=1,
            )
            text = re.sub(
                r'(<[^>]+id="ol-mesh-relays"[^>]*>.*?</[^>]+>\s*</div>\s*'
                r'<div class="row"><span class="key">.*?</span><span class="val">)'
                r'.*?(</span>)',
                r'\1illustrative\2', text, count=1,
            )
            text = re.sub(
                r'<pre class="ol-code">(?:(?!</pre>)[\s\S])*?helmholtz_step(?:(?!</pre>)[\s\S])*</pre>',
                '<pre class="ol-code" data-claim-scope="roadmap-topology">// illustrative roadmap pseudocode; not live daemon topology or routing telemetry\nfield = proposed_coherence_step(validated_website_presence)</pre>',
                text,
                count=1,
            )
            text = replace_indexed_blocks(
                text,
                PARAGRAPH_RE,
                {0: f'<p class="lede">{c["mesh_lede"]}</p>',
                 1: f'<p>{c["mesh_presence"]}</p>',
                 2: f'<p>{c["mesh_region"]}</p>',
                 3: f'<p>{c["mesh_presence"]}</p>'},
                "mesh truth",
            )
            text = replace_article_paragraphs(
                text, {0: str(c["mesh_presence"]), 1: str(c["mesh_ids"]), 2: str(c["mesh_region"])},
                "mesh inventory",
            )
            text = rewrite_section_heading_and_lede(
                text, 'href="/builders/"', scope["future_h"], scope["mesh_cta"], "mesh install CTA"
            )
            return text

        if slug == "builders":
            def relay_section(block: str) -> bool:
                return "one-link-relay" in block

            def rewrite_relay(block: str) -> str:
                block = re.sub(
                    r'<p class="lede">(?:(?!</p>)[\s\S])*</p>',
                    f'<p class="lede">{c["builder_relay"]}</p>', block, count=1,
                )
                block = re.sub(
                    r'<pre class="ol-code">(?:(?!</pre>)[\s\S])*</pre>',
                    f'<pre class="ol-code">{c["builder_command"]}</pre>', block, count=1,
                )
                block = re.sub(
                    r'<p class="ol-footnote-soft">(?:(?!</p>)[\s\S])*</p>',
                    f'<p class="ol-footnote-soft">{c["builder_footnote"]}</p>', block, count=1,
                )
                return block

            text = SECTION_RE.sub(
                lambda m: rewrite_relay(m.group(0)) if relay_section(m.group(0)) else m.group(0), text
            )
            if str(c["builder_relay"]) not in text:
                raise ValueError("missing builder relay boundary")
            text = rewrite_section_heading_and_lede(
                text,
                "ol_pair_qr",
                scope["audit_evidence_h"],
                scope["internal_evidence"],
                "builder crate evidence scope",
            )
            text = replace_article_content(
                text,
                {
                    2: (None, scope["internal_evidence"]),
                    5: (None, scope["internal_evidence"]),
                    9: (None, scope["internal_evidence"]),
                },
                "builder benchmark claims",
            )
            for crate_name, body in c["builder_crates"].items():
                text = replace_article_paragraph_by_heading(
                    text,
                    str(crate_name),
                    str(body),
                    f"builder {crate_name} capability",
                )
            return text

        if slug == "accessibility":
            text = replace_descriptions(text, ACCESSIBILITY_SCOPES[locale])
            text = replace_indexed_blocks(
                text, PARAGRAPH_RE,
                {0: f'<p class="lede">{ACCESSIBILITY_SCOPES[locale]}</p>'},
                "accessibility scope",
            )
            text = replace_indexed_blocks(
                text, H2_RE,
                {0: f'<h2>{scope["access_h"]}</h2>', 1: f'<h2>{scope["access_h"]}</h2>',
                 3: f'<h2>{scope["access_h"]}</h2>'},
                "accessibility headings",
            )
            text = replace_article_paragraphs(
                text,
                {0: scope["access_item"], 1: scope["access_item"], 2: scope["access_item"],
                 3: scope["access_item"], 4: scope["access_item"], 5: scope["access_item"],
                 6: scope["access_item"], 7: str(c["access_qr"]), 8: scope["access_item"]},
                "accessibility evidence",
            )
            scope_roots = (
                "current intentions", "intenciones y carencias", "intentions et lacunes",
                "aktuelle absichten", "intenções e lacunas", "intenzioni e lacune",
            )
            text = replace_matching_blocks(
                text, PARAGRAPH_RE,
                lambda block: "pa11y" in block.lower() or any(root in block.lower() for root in scope_roots),
                f'<p class="lede">{ACCESSIBILITY_SCOPES[locale]}</p>',
            )
            reviewed = {
                "en": "Accessibility statement reviewed 2026-07-22.", "es": "Declaración de accesibilidad revisada el 2026-07-22.",
                "fr": "Déclaration d'accessibilité revue le 2026-07-22.", "de": "Erklärung zur Barrierefreiheit am 2026-07-22 geprüft.",
                "pt": "Declaração de acessibilidade revista em 2026-07-22.", "it": "Dichiarazione di accessibilità rivista il 2026-07-22.",
            }
            return replace_review_date(text, reviewed[locale])

        if slug == "mirror":
            text = replace_descriptions(text, str(c["mirror_desc"]))
            text = replace_indexed_blocks(
                text, H1_RE, {0: f'<h1>{scope["mirror_h"]}</h1>'}, "mirror scope heading"
            )
            text = replace_indexed_blocks(
                text, PARAGRAPH_RE, {0: f'<p class="lede">{c["mirror_lede"]}</p>'}, "mirror lede"
            )
            text = replace_article_paragraphs(
                text,
                {2: str(c["mirror_latency"]), 3: str(c["mirror_resilience"]),
                 4: str(c["mirror_local"]), 5: str(c["mirror_local"]),
                 6: str(c["mirror_local"]), 7: str(c["mirror_local"])},
                "mirror boundaries",
            )
            text = replace_matching_blocks(
                text, PARAGRAPH_RE,
                lambda block: "localhost:8080" in block and ("mesh" in block.lower() or "WASM" in block),
                f'<p>{c["mirror_local"]}</p>',
            )
            text = replace_matching_blocks(
                text, PARAGRAPH_RE,
                lambda block: 'class="lede"' in block
                and bool(re.search(r"\b(?:onion|tor)\b", block.lower())),
                f'<p class="lede">{c["mirror_tor"]}</p>',
            )
            text = re.sub(
                rf'(<p class="lede">{re.escape(str(c["mirror_tor"]))}</p>)\s*'
                rf'<p>{re.escape(str(c["mirror_tor"]))}</p>',
                r'\1', text, count=1,
            )
            text = replace_matching_blocks(
                text, PARAGRAPH_RE,
                lambda block: "ipfs://" in block,
                f'<p>{c["mirror_ipfs"]}</p>',
            )
            return text

        if slug == "roadmap":
            text = replace_indexed_blocks(
                text, PARAGRAPH_RE, {2: f'<p class="ol-prose">{c["roadmap_note"]}</p>'}, "roadmap status"
            )
            text = replace_article_paragraphs(
                text, {2: str(c["roadmap_operator"]), 13: str(c["roadmap_fs"]),
                       27: str(c["roadmap_operator"])}, "roadmap boundaries"
            )
            roadmap_indexes = {
                "silent_loss": 10,
                "remote_pair": 15,
                "timing_analysis": 17,
                "hardware_keys": 19,
                "telemetry": 29,
            }
            roadmap_cards = c["roadmap_cards"]
            text = replace_article_content(
                text,
                {
                    roadmap_indexes[key]: (str(value[0]), str(value[1]))
                    for key, value in roadmap_cards.items()
                },
                "roadmap threat-model targets",
            )
            for key, value in roadmap_cards.items():
                text = mark_article_claim(
                    text,
                    str(value[0]),
                    f"roadmap-{key.replace('_', '-')}",
                    f"roadmap {key}",
                )
            reviewed = {
                "en": "Roadmap reviewed 2026-07-22.", "es": "Hoja de ruta revisada el 2026-07-22.",
                "fr": "Feuille de route revue le 2026-07-22.", "de": "Roadmap am 2026-07-22 geprüft.",
                "pt": "Roteiro revisto em 2026-07-22.", "it": "Roadmap rivista il 2026-07-22.",
            }
            return replace_review_date(text, reviewed[locale])

        if slug == "about":
            text = replace_descriptions(text, str(c["home_social"]))
            text = replace_indexed_blocks(
                text,
                PARAGRAPH_RE,
                {0: f'<p class="lede">{c["about_covenant"]}</p>',
                 1: f'<p class="ol-prose">{c["about_operation"]}</p>',
                 2: f'<p class="ol-prose">{c["about_use"]}</p>',
                 3: f'<p class="ol-prose">{c["about_open"]}</p>',
                 4: f'<p class="ol-prose">{c["about_release"]}</p>',
                 5: f'<p class="ol-prose">{c["about_open"]}</p>',
                 6: f'<p class="ol-prose">{scope["internal_evidence"]}</p>',
                 7: f'<p class="ol-prose">{c["about_covenant"]}</p>',
                 8: f'<p class="ol-prose">{c["about_covenant"]}</p>'},
                "about boundaries",
            )
            return text

        if slug == "terms":
            text = replace_indexed_blocks(
                text, PARAGRAPH_RE, {1: f'<p class="ol-prose">{c["terms_dependency"]}</p>'}, "terms dependency"
            )
            reviewed = {
                "en": "Terms reviewed 2026-07-22.", "es": "Términos revisados el 2026-07-22.",
                "fr": "Conditions revues le 2026-07-22.", "de": "Bedingungen am 2026-07-22 geprüft.",
                "pt": "Termos revistos em 2026-07-22.", "it": "Termini rivisti il 2026-07-22.",
            }
            return replace_review_date(text, reviewed[locale])

        if slug == "audits":
            text = replace_descriptions(text, str(c["audits_desc"]))
            text = replace_indexed_blocks(
                text, H1_RE, {0: f'<h1>{scope["audit_h"]}</h1>'}, "audit heading"
            )
            text = replace_indexed_blocks(
                text,
                PARAGRAPH_RE,
                {0: f'<p class="lede">{c["audits_lede"]}</p>',
                 3: f'<p class="ol-mt-md">{c["audits_history"]}</p>'},
                "audit register",
            )
            text = rewrite_section_heading_and_lede(
                text,
                "cargo fuzz" if "cargo fuzz" in text else scope["audit_internal_h"],
                scope["audit_internal_h"],
                str(c["audits_lede"]),
                "internal review register",
            )
            text = rewrite_section_heading_and_lede(
                text, "scripts/sign-manifest.py", scope["audit_evidence_h"], str(c["audits_history"]),
                "audit evidence pointers",
            )
            text = replace_article_content(
                text,
                {
                    8: (None, scope["internal_evidence"]),
                    9: (None, scope["internal_evidence"]),
                    10: (None, scope["internal_evidence"]),
                    11: (None, scope["internal_evidence"]),
                    12: (None, scope["internal_evidence"]),
                    13: (None, scope["internal_evidence"]),
                    16: (None, scope["internal_evidence"]),
                },
                "audit internal evidence",
            )
            return text

        if slug == "changelog":
            text = replace_indexed_blocks(
                text, PARAGRAPH_RE, {0: f'<p class="lede">{c["changelog_lede"]}</p>'}, "changelog scope"
            )
            if locale == "en":
                text = rewrite_historical_autoinstall_entry(text)
                correction = (
                    "<li><strong>Current correction:</strong> The experimental updater compares bytes with a checksum "
                    "from the same mutable channel. This can detect corruption but does not authenticate the publisher; "
                    "rolling artifacts are unsigned.</li>"
                )
                text = replace_matching_blocks(
                    text, LIST_ITEM_RE,
                    lambda block: "polls GitHub Releases" in block or "unverified binary" in block,
                    correction,
                )
                text = replace_matching_blocks(
                    text, LIST_ITEM_RE,
                    lambda block: "full bytes-in-tab verification" in block,
                    "<li><strong>Current correction:</strong> The tab computes a local hash; without an authenticated reference it does not verify publisher identity.</li>",
                )
            return text

        if slug == "404":
            text = replace_indexed_blocks(
                text,
                PARAGRAPH_RE,
                {0: f'<p class="lede">{c["404_hero"]}</p>',
                 1: f'<p>{c["404_download"]}</p>',
                 2: f'<p>{c["404_primitives"]}</p>',
                 3: f'<p>{c["404_mesh"]}</p>'},
                "404 truth",
            )
            presence_hits = 0

            def rewrite_presence_card(match: re.Match[str]) -> str:
                nonlocal presence_hits
                block = match.group(0)
                if str(c["404_mesh"]) not in block:
                    return block
                presence_hits += 1
                block = re.sub(
                    r'<h3(?P<attrs>[^>]*)>(?:(?!</h3>)[\s\S])*</h3>',
                    f'<h3>{PRESENCE_LINK_LABELS[locale]}</h3>',
                    block,
                    count=1,
                )
                return re.sub(
                    r'(<a href="/mesh/"[^>]*>)(?:(?!</a>)[\s\S])*(</a>)',
                    rf'\1{PRESENCE_LINK_LABELS[locale]} <span class="arr">&rarr;</span>\2',
                    block,
                    count=1,
                )

            text = ARTICLE_RE.sub(rewrite_presence_card, text)
            if presence_hits != 1:
                raise ValueError(f"404 presence card drift: expected 1, found {presence_hits}")
            return text

        if slug == "one":
            return replace_indexed_blocks(
                text,
                PARAGRAPH_RE,
                {32: f'<p>{c["one_network"]}</p>', 33: f'<p>{c["one_crypto"]}</p>'},
                "one manifesto product boundary",
            )

        return text

    return transform


def rewrite(path: Path, transform, check: bool) -> bool:
    old = path.read_text(encoding="utf-8")
    relative = path.relative_to(DIST)
    locale = relative.parts[0] if relative.parts and relative.parts[0] in LOCALE_PATHS else "en"
    new = global_surface_transform(transform(old), locale)
    if new == old:
        return False
    if check:
        print(f"OUT OF DATE: {path.relative_to(ROOT)}")
    else:
        path.write_text(new, encoding="utf-8", newline="\n")
        print(f"UPDATED: {path.relative_to(ROOT)}")
    return True


def rewrite_plain(path: Path, new: str, check: bool) -> bool:
    old = path.read_text(encoding="utf-8")
    if new == old:
        return False
    if check:
        print(f"OUT OF DATE: {path.relative_to(ROOT)}")
    else:
        path.write_text(new, encoding="utf-8", newline="\n")
        print(f"UPDATED: {path.relative_to(ROOT)}")
    return True


def root_404_transform(text: str) -> str:
    stale = "Free, signed binaries for every platform plus a one-click source build."
    current = (
        "Free and open-source. Rolling test artifacts are available for supported "
        "desktop platforms; artifact signatures are not published."
    )
    if stale in text:
        return text.replace(stale, current, 1)
    if current not in text:
        raise ValueError("missing truthful 404 distribution status")
    return text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="fail if generated surfaces drift")
    args = parser.parse_args()
    changed = False

    for locale, c in COPY.items():
        def download_transform(text: str, c=c) -> str:
            text = replace_head(text, str(c["download_title"]), str(c["download_desc"]))
            text, n = MAIN_RE.subn(download_main(c), text, count=1)
            if n != 1:
                raise ValueError("missing download main")
            return text

        def verify_transform(text: str, c=c) -> str:
            text = replace_head(text, str(c["verify_title"]), str(c["verify_desc"]))
            text, n = MAIN_RE.subn(verify_main(c), text, count=1)
            if n != 1:
                raise ValueError("missing verify main")
            return text

        def release_transform(text: str, c=c) -> str:
            text = replace_head(text, str(c["release_title"]), str(c["release_desc"]))
            text, n = MAIN_RE.subn(release_main(c), text, count=1)
            if n != 1:
                raise ValueError("missing release main")
            return text

        def builder_transform(text: str, c=c) -> str:
            text, n = BUILDER_RE.subn(builder_section(c), text, count=1)
            if n != 1:
                raise ValueError("missing builder proof section")
            return text

        changed |= rewrite(page_path(locale, "download"), download_transform, args.check)
        changed |= rewrite(page_path(locale, "verify-download"), verify_transform, args.check)
        changed |= rewrite(page_path(locale, "releases"), release_transform, args.check)

        # Pages that carry more than one release-truth concern are transformed in
        # one in-memory pass.  Besides avoiding partially generated files, this is
        # essential for a meaningful --check: a later transform can legitimately
        # replace copy emitted by an earlier migration transform, so checking each
        # stage against disk independently would report false drift forever.
        extended = EXTENDED_COPY[locale]
        surface = SURFACE_COPY[locale]
        scope = CLAIM_SCOPE_COPY[locale]
        home_path = DIST / LOCALE_PATHS[locale] / "index.html" if LOCALE_PATHS[locale] else DIST / "index.html"
        changed |= rewrite(
            home_path,
            lambda text, surface=surface, scope=scope: home_surface_transform(text, surface, scope),
            args.check,
        )
        for slug in (
            "features", "how-it-works", "share", "privacy", "security", "transparency",
            "mesh", "builders", "accessibility", "mirror", "roadmap", "about", "terms",
            "audits", "changelog", "one",
        ):
            def page_transform(
                text: str,
                *,
                slug=slug,
                locale=locale,
                release_copy=c,
                extended_copy=extended,
                surface_copy=surface,
            ) -> str:
                if slug == "builders":
                    text = builder_transform(text)
                if slug in {"about", "features", "security", "roadmap", "changelog"}:
                    text = release_claim_transform(slug, release_copy)(text)
                if slug in {"security", "mirror", "transparency"}:
                    text = extended_surface_transform(slug, extended_copy)(text)
                return capability_surface_transform(locale, slug, surface_copy)(text)

            changed |= rewrite(
                page_path(locale, slug),
                page_transform,
                args.check,
            )
        error_path = DIST / LOCALE_PATHS[locale] / "404.html" if LOCALE_PATHS[locale] else DIST / "404.html"
        changed |= rewrite(
            error_path,
            capability_surface_transform(locale, "404", surface),
            args.check,
        )

    def cl_home_transform(text: str) -> str:
        old = "Only you and they can read it."
        new = "Encrypted on supported paths."
        if old in text:
            return text.replace(old, new)
        if new not in text:
            raise ValueError("missing index.cl confidentiality boundary")
        return text

    changed |= rewrite_plain(DIST / ".well-known" / "security.txt", security_txt(), args.check)
    changed |= rewrite(DIST / "index.cl.html", cl_home_transform, args.check)

    if args.check and changed:
        print("Run: python scripts/apply_release_truth.py")
        return 1
    print("Release truth surfaces are current.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
