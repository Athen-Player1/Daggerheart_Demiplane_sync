import { MODULE_ID, extractDemiplaneCharacterId, parseDemiplaneCharacterHtml, summarizeForBiography } from './parser.mjs';

const TEMPLATE = `modules/${MODULE_ID}/templates/import-dialog.hbs`;
const PACKS = {
    class: ['daggerheart.classes'],
    subclass: ['daggerheart.subclasses'],
    ancestry: ['daggerheart.ancestries'],
    community: ['daggerheart.communities'],
    domain: ['daggerheart.domains'],
    weapon: ['daggerheart.weapons'],
    armor: ['daggerheart.armors'],
    consumable: ['daggerheart.consumables'],
    loot: ['daggerheart.loot']
};

Hooks.once('init', () => {
    game.settings.register(MODULE_ID, 'corsProxy', {
        name: game.i18n.localize('DEMIPLANE_DH.settings.corsProxy.name'),
        hint: game.i18n.localize('DEMIPLANE_DH.settings.corsProxy.hint'),
        scope: 'world',
        config: true,
        type: String,
        default: ''
    });
});

Hooks.once('ready', () => {
    if (game.system.id !== 'daggerheart') {
        ui.notifications.warn(game.i18n.localize('DEMIPLANE_DH.notifications.systemRequired'));
        return;
    }
    console.log(`${MODULE_ID} | Ready`);
});

Hooks.on('getActorDirectoryEntryContext', (_html, options) => {
    options.push({
        name: game.i18n.localize('DEMIPLANE_DH.controls.update'),
        icon: '<i class="fa-solid fa-rotate"></i>',
        condition: li => getActorFromDirectoryEntry(li)?.type === 'character',
        callback: li => updateActorFromSavedUrl(getActorFromDirectoryEntry(li))
    });
});

Hooks.on('renderActorSheet', (app, html) => {
    const actor = app.actor ?? app.document;
    if (actor?.type !== 'character') return;

    const roots = [app.element, html]
        .map(element => (element instanceof jQuery ? element[0] : element))
        .filter(element => element instanceof HTMLElement);
    const root = roots.find(element => !element.querySelector('.demiplane-dh-update-button'));
    if (!root) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'demiplane-dh-update-button demiplane-dh-sheet-action';
    button.innerHTML = `<i class="fa-solid fa-rotate"></i> ${game.i18n.localize('DEMIPLANE_DH.controls.update')}`;
    button.addEventListener('click', event => {
        event.preventDefault();
        updateActorFromSavedUrl(actor);
    });

    const titleArea = root.querySelector('.window-header')
        ?? root.querySelector('.window-title')
        ?? root.querySelector('header')
        ?? root.querySelector('form')
        ?? root;
    titleArea.append(button);
});

function getActorFromDirectoryEntry(li) {
    const element = li instanceof jQuery ? li[0] : li;
    const id = element?.dataset?.documentId
        ?? element?.dataset?.entryId
        ?? element?.closest?.('[data-document-id]')?.dataset?.documentId
        ?? element?.closest?.('[data-entry-id]')?.dataset?.entryId;
    return id ? game.actors.get(id) : null;
}

Hooks.on('getSceneControlButtons', controls => {
    const tokenControls = controls.tokens ?? controls.find?.(c => c.name === 'token')?.tools;
    const tool = {
        name: 'demiplane-dh-import',
        title: game.i18n.localize('DEMIPLANE_DH.controls.import'),
        icon: 'fa-solid fa-file-import',
        visible: game.user.isGM,
        button: true,
        onClick: () => showImportDialog()
    };

    if (Array.isArray(tokenControls)) tokenControls.push(tool);
    else if (controls.tokens?.tools) controls.tokens.tools['demiplane-dh-import'] = tool;
});

async function showImportDialog() {
    const content = await renderTemplate(TEMPLATE, { url: '' });
    new Dialog({
        title: game.i18n.localize('DEMIPLANE_DH.dialog.title'),
        content,
        buttons: {},
        render: html => {
            const root = html instanceof jQuery ? html[0] : html;
            root.querySelector('form')?.addEventListener('submit', async event => {
                event.preventDefault();
                const url = new FormData(event.currentTarget).get('url');
                await importFromUrl(url);
                root.closest('.app')?.querySelector('.header-button.close')?.click();
            });
            root.querySelector('[data-action="cancel"]')?.addEventListener('click', event => {
                event.currentTarget.closest('.app')?.querySelector('.header-button.close')?.click();
            });
        }
    }).render(true);
}

async function importFromUrl(url) {
    validateUrl(url);
    const normalized = await fetchAndParse(url);

    // Foundryborne's Daggerheart character model has a rich default attack Action.
    // In Foundry v14, passing a partial `system` object at Actor.create time can
    // suppress/poison those nested defaults and causes Action validation failures.
    // Create the actor with only document-level data first, then apply partial
    // system updates after the system has initialized its own defaults.
    const actor = await Actor.create(buildActorCreateData(normalized));
    if (!actor) throw new Error('Actor creation failed; Foundry did not return a created actor.');

    await actor.update(buildActorPostCreateUpdate(normalized));
    await syncImportedItems(actor, normalized);
    ui.notifications.info(game.i18n.format('DEMIPLANE_DH.notifications.imported', { name: actor.name }));
    actor.sheet?.render(true);
    return actor;
}

async function updateActorFromSavedUrl(actor) {
    if (!actor) return;
    const url = actor.getFlag(MODULE_ID, 'sourceUrl');
    if (!url) return ui.notifications.warn(game.i18n.localize('DEMIPLANE_DH.notifications.noUrl'));

    const normalized = await fetchAndParse(url);
    await actor.update(buildActorUpdate(normalized));
    await syncImportedItems(actor, normalized);
    ui.notifications.info(game.i18n.format('DEMIPLANE_DH.notifications.updated', { name: actor.name }));
    actor.sheet?.render(false);
}

async function fetchAndParse(url) {
    const response = await fetchDemiplane(url);
    const html = await response.text();
    return parseDemiplaneCharacterHtml(html, url);
}

async function fetchDemiplane(url) {
    const proxyTemplate = game.settings.get(MODULE_ID, 'corsProxy')?.trim();
    const target = proxyTemplate ? proxyTemplate.replace('{url}', encodeURIComponent(url)) : url;

    try {
        const response = await fetch(target, { credentials: 'omit' });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response;
    } catch (error) {
        ui.notifications.error(`${game.i18n.localize('DEMIPLANE_DH.notifications.corsHelp')} (${error.message})`);
        throw error;
    }
}

function validateUrl(url) {
    if (!extractDemiplaneCharacterId(url)) throw new Error(game.i18n.localize('DEMIPLANE_DH.notifications.invalidUrl'));
}

function buildActorCreateData(normalized) {
    return {
        name: normalized.name,
        type: 'character',
        img: normalized.img,
        flags: buildFlags(normalized)
    };
}

function buildActorPostCreateUpdate(normalized) {
    return {
        system: buildSystemUpdate(normalized),
        flags: buildFlags(normalized)
    };
}

function buildActorUpdate(normalized) {
    return {
        name: normalized.name,
        img: normalized.img,
        system: buildSystemUpdate(normalized),
        flags: buildFlags(normalized)
    };
}

function buildSystemUpdate(normalized) {
    return {
        biography: {
            background: summarizeForBiography(normalized)
        },
        levelData: {
            level: {
                current: normalized.level,
                changed: normalized.level
            }
        }
    };
}

function buildFlags(normalized) {
    return {
        [MODULE_ID]: {
            sourceUrl: normalized.sourceUrl,
            sourceId: normalized.id,
            numericId: normalized.numericId,
            demiplaneUpdated: normalized.updated,
            importedAt: new Date().toISOString(),
            selections: normalized.selections
        }
    };
}

async function syncImportedItems(actor, normalized) {
    const oldImportedIds = actor.items
        .filter(item => item.getFlag(MODULE_ID, 'imported'))
        .map(item => item.id);
    if (oldImportedIds.length) await actor.deleteEmbeddedDocuments('Item', oldImportedIds);

    const selections = {
        class: normalized.selections.class && { kind: 'class', ...normalized.selections.class },
        ancestry: normalized.selections.ancestry && { kind: 'ancestry', ...normalized.selections.ancestry },
        community: normalized.selections.community && { kind: 'community', ...normalized.selections.community },
        subclass: normalized.selections.subclass && { kind: 'subclass', ...normalized.selections.subclass },
        domains: normalized.selections.domainCards.map(x => ({ kind: 'domain', ...x })),
        equipment: normalized.selections.equipment.map(x => ({ kind: guessEquipmentKind(x), ...x })),
        customEquipment: normalized.selections.customEquipment.map(x => ({ kind: 'loot', ...x }))
    };

    const missing = [];
    const createSelectionBatch = async batch => {
        const itemData = [];
        for (const selection of batch.filter(Boolean)) {
            const found = await findPackItem(selection.kind, selection.name);
            if (found) {
                const data = found.toObject();
                // Preserve the compendium origin. Foundryborne's Daggerheart system
                // uses Item#sourceUuid to validate subclass <-> class links. A plain
                // toObject/createEmbeddedDocuments copy can lose that origin, making a
                // perfectly valid subclass look unrelated to its class.
                data._stats = foundry.utils.mergeObject(data._stats ?? {}, {
                    compendiumSource: found.uuid,
                    duplicateSource: found.uuid
                });
                data.flags = foundry.utils.mergeObject(data.flags ?? {}, itemFlags(selection));
                itemData.push(data);
            } else {
                missing.push(`${selection.kind}: ${selection.name}`);
                itemData.push(buildPlaceholderLoot(selection));
            }
        }
        if (!itemData.length) return [];
        return actor.createEmbeddedDocuments('Item', itemData);
    };

    // Foundryborne validates some item types against already-created actor state:
    // subclass and domain cards require a class to exist, and domain cards require
    // the class domains to be known. Create dependency-bearing items in waves.
    const createdClassItems = await createSelectionBatch([selections.class]);
    await applyClassDerivedStats(actor, createdClassItems[0], normalized);
    await createSelectionBatch([selections.ancestry, selections.community]);
    await createSelectionBatch([selections.subclass]);
    await createSelectionBatch(selections.equipment);
    await createSelectionBatch(selections.domains);
    await createSelectionBatch(selections.customEquipment);

    await actor.setFlag(MODULE_ID, 'missingCompendiumMatches', missing);
}

async function applyClassDerivedStats(actor, classItem, normalized) {
    if (!classItem) return;
    const update = {};
    const suggestedTraits = classItem.system?.characterGuide?.suggestedTraits;
    for (const [trait, value] of Object.entries(suggestedTraits ?? {})) {
        foundry.utils.setProperty(update, `system.traits.${trait}.value`, Number(value) || 0);
    }

    if (Number.isNumeric?.(classItem.system?.evasion) || Number.isFinite(Number(classItem.system?.evasion))) {
        foundry.utils.setProperty(update, 'system.evasion', Number(classItem.system.evasion));
    }

    const hpBonus = normalized.selections.levelUps.filter(x => x.slug === 'add-hp').length;
    const baseHp = Number(classItem.system?.hitPoints);
    if (Number.isFinite(baseHp)) {
        foundry.utils.setProperty(update, 'system.resources.hitPoints.max', baseHp + hpBonus);
    }

    const evasionBonus = normalized.selections.levelUps.filter(x => x.slug === 'increase-evasion').length;
    if (evasionBonus) {
        const currentEvasion = Number(foundry.utils.getProperty(update, 'system.evasion') ?? actor.system.evasion ?? 0);
        foundry.utils.setProperty(update, 'system.evasion', currentEvasion + evasionBonus);
    }

    if (!foundry.utils.isEmpty(update)) await actor.update(update);
}

function itemFlags(selection) {
    return {
        [MODULE_ID]: {
            imported: true,
            sourceName: selection.name,
            sourceSlug: selection.slug,
            sourceKind: selection.kind
        }
    };
}

function buildPlaceholderLoot(selection) {
    return {
        name: selection.name,
        type: 'loot',
        flags: itemFlags(selection)
    };
}

function guessEquipmentKind(selection) {
    const slug = `${selection.slug ?? ''} ${selection.name ?? ''}`.toLowerCase();
    if (slug.includes('armor') || slug.includes('gambeson') || slug.includes('chainmail')) return 'armor';
    if (slug.includes('potion')) return 'consumable';
    return 'weapon';
}

async function findPackItem(kind, name) {
    const normalized = normalizeName(name);
    for (const packId of PACKS[kind] ?? []) {
        const pack = game.packs.get(packId);
        if (!pack) continue;
        const index = await pack.getIndex({ fields: ['name', 'type'] });
        const hit = index.find(entry => normalizeName(entry.name) === normalized);
        if (hit) return pack.getDocument(hit._id);
    }

    if (['weapon', 'armor', 'consumable'].includes(kind)) return findPackItem('loot', name);
    return null;
}

function normalizeName(name) {
    return String(name ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\bplaytest\b/g, '')
        .trim();
}

globalThis.DemiplaneDaggerheartImporter = {
    importFromUrl,
    updateActorFromSavedUrl,
    parseDemiplaneCharacterHtml
};
