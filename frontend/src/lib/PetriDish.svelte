<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Application, Graphics, Container, Text, TextStyle } from "pixi.js";
  import { Viewport } from "pixi-viewport";
  import { world } from "./world.svelte";
  import type { EntitySnapshot } from "./websocket";
  import { getArchetypeKey } from "./utils";
  import { getArchetypeColor } from "./colors";
  import {
    SCALE_THRESHOLDS,
    MICRO_MAX_ACTIVE_NEIGHBORS,
    SPAWN_DURATION,
    DESTROY_DURATION,
    PULSE_DURATION,
    GRID_COLOR,
    GRID_ALPHA,
    WORLD_SIZE,
    DETAIL_BASE_RADIUS,
    DETAIL_RADIUS_PER_COMPONENT,
    DETAIL_MIN_RADIUS,
    DETAIL_MAX_RADIUS,
    MESO_RADIUS,
    MACRO_RADIUS,
    MESO_GRID_SIZE,
    CLUSTER_LABEL_THRESHOLD,
    MACRO_GRID_COLS,
    MACRO_GRID_ROWS,
    MACRO_CELL_MIN_ALPHA,
    MACRO_CELL_MAX_ALPHA,
  } from "./config";

  type ZoomLevel = "micro" | "detail" | "meso" | "macro";

  let currentZoomLevel = $state<ZoomLevel>("detail");
  let visibleEntityCount = $state(0);
  let isPixiReady = $state(false);
  let mouseWorldPos: { x: number; y: number } | null = null;

  // Micro view state for camera following and cooldown
  let lastSelectedPosition: { x: number; y: number } | null = null;
  let isAnimatingToSelected = false;
  let microViewExitTime = 0;
  const MICRO_VIEW_COOLDOWN_MS = 500;

  let container: HTMLDivElement;

  let app: Application | null = null;
  let viewport: Viewport | null = null;
  let gridGraphics: Graphics | null = null;
  let entityContainer: Container | null = null;
  let tooltipText: Text | null = null;
  let mesoContainer: Container | null = null;
  let macroContainer: Container | null = null;

  let clusterData = $state<ClusterData | null>(null);
  let densityData = $state<DensityData | null>(null);

  let visibleArchetypes = $derived.by(() => {
    if (currentZoomLevel === "macro" && densityData) {
      const archetypeCounts = new Map<string, number>();
      for (const cell of densityData.cells) {
        if (cell.dominantArchetype) {
          const key = cell.dominantArchetype.join(",");
          archetypeCounts.set(key, (archetypeCounts.get(key) ?? 0) + cell.count);
        }
      }
      return Array.from(archetypeCounts.entries())
        .map(([key, count]) => ({
          archetype: key.split(","),
          count,
          color: getArchetypeColor(key.split(",")),
        }))
        .sort((a, b) => b.count - a.count);
    }
    const archetypeCounts = new Map<string, number>();
    for (const entity of world.filteredEntities) {
      const key = entity.archetype.join(",");
      archetypeCounts.set(key, (archetypeCounts.get(key) ?? 0) + 1);
    }
    return Array.from(archetypeCounts.entries())
      .map(([key, count]) => ({
        archetype: key.split(","),
        count,
        color: getArchetypeColor(key.split(",")),
      }))
      .sort((a, b) => b.count - a.count);
  });

  const entityGraphics = new Map<number, Graphics>();

  type AnimationState = {
    type: "spawn" | "destroy" | "pulse";
    progress: number; // 0 to 1
  };
  const entityAnimations = new Map<number, AnimationState>();

  interface MesoCluster {
    cellX: number;
    cellY: number;
    worldX: number; // Center of cell in world coords
    worldY: number;
    entityIds: number[];
    count: number;
    dominantArchetype: string[];
    dominantColor: number;
    archetypeBreakdown: Map<string, number>;
  }

  interface ClusterData {
    tick: number;
    clusters: MesoCluster[];
    totalEntities: number;
  }

  interface DensityCell {
    cellX: number;
    cellY: number;
    worldBounds: { x: number; y: number; width: number; height: number };
    count: number;
    density: number; // 0-1 normalized
    dominantArchetype: string[] | null;
    dominantColor: number;
  }

  interface DensityData {
    tick: number;
    cells: DensityCell[];
    maxDensity: number;
    totalEntities: number;
  }

  /** Blend two colors: t=0 returns color1, t=1 returns color2. */
  function blendColors(color1: number, color2: number, t: number): number {
    const r1 = (color1 >> 16) & 0xff;
    const g1 = (color1 >> 8) & 0xff;
    const b1 = color1 & 0xff;

    const r2 = (color2 >> 16) & 0xff;
    const g2 = (color2 >> 8) & 0xff;
    const b2 = color2 & 0xff;

    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);

    return (r << 16) | (g << 8) | b;
  }

  /**
   * Calculate entity radius based on component count and zoom level.
   * In MICRO mode, returns screen-space size (will be divided by scale).
   */
  function getEntityRadius(entity: EntitySnapshot, zoomLevel: ZoomLevel): number {
    switch (zoomLevel) {
      case "micro":
        // Fixed screen-space size for micro view (will be divided by viewport scale)
        const microRadius =
          DETAIL_BASE_RADIUS * 2 + entity.components.length * DETAIL_RADIUS_PER_COMPONENT;
        return Math.min(DETAIL_MAX_RADIUS * 2, Math.max(DETAIL_MIN_RADIUS * 2, microRadius));
      case "detail":
        const detailRadius =
          DETAIL_BASE_RADIUS + entity.components.length * DETAIL_RADIUS_PER_COMPONENT;
        return Math.min(DETAIL_MAX_RADIUS, Math.max(DETAIL_MIN_RADIUS, detailRadius));
      case "meso":
        return MESO_RADIUS;
      case "macro":
        return MACRO_RADIUS;
    }
  }

  /**
   * Get the scale factor to apply for screen-space rendering in MICRO mode.
   * Returns 1 for other modes (world-space sizing).
   */
  function getScreenSpaceScale(): number {
    if (!viewport || currentZoomLevel !== "micro") return 1;
    return 1 / viewport.scale.x;
  }

  /**
   * Determine zoom level based on viewport scale and selection state.
   */
  function calculateZoomLevel(scale: number, canEnterMicro: boolean): ZoomLevel {
    if (scale >= SCALE_THRESHOLDS.micro && canEnterMicro) return "micro";
    if (scale >= SCALE_THRESHOLDS.detail) return "detail";
    if (scale >= SCALE_THRESHOLDS.meso) return "meso";
    return "macro";
  }

  /**
   * Check if entity is visible in viewport.
   */
  function isEntityVisible(pos: { x: number; y: number }): boolean {
    if (!viewport) return true;

    const bounds = viewport.getVisibleBounds();
    return (
      pos.x >= bounds.x &&
      pos.x <= bounds.x + bounds.width &&
      pos.y >= bounds.y &&
      pos.y <= bounds.y + bounds.height
    );
  }

  // Set of entity IDs that are "active" in micro mode (selected + closest neighbors)
  // NOT reactive - computed during render, used only for rendering decisions
  let microActiveIds: Set<number> = new Set();

  /**
   * Compute active entity IDs for micro mode based on selected entity.
   * Active entities are rendered fully, others are fog-of-war.
   */
  function computeMicroActiveIds(): void {
    if (!viewport) {
      microActiveIds = new Set();
      return;
    }

    const selectedId = world.selectedEntityId;
    if (selectedId === null) {
      microActiveIds = new Set();
      return;
    }

    const selectedEntity = world.getEntity(selectedId);
    if (!selectedEntity) {
      // Selected entity was destroyed - clear selection and zoom out
      world.selectEntity(null);
      exitMicroView(true);
      microActiveIds = new Set();
      return;
    }

    // Compute neighbors relative to selected entity
    const selectedPos = getEntityPosition(selectedEntity);
    const entityDistances: { id: number; dist: number }[] = [];

    for (const entity of world.filteredEntities) {
      if (entity.id === selectedId) continue;
      const pos = getEntityPosition(entity);
      const dx = pos.x - selectedPos.x;
      const dy = pos.y - selectedPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      entityDistances.push({ id: entity.id, dist });
    }

    entityDistances.sort((a, b) => a.dist - b.dist);

    const activeIds = new Set<number>();
    activeIds.add(selectedId);

    const maxDistance = 200 / viewport.scale.x;
    for (let i = 0; i < entityDistances.length && activeIds.size <= MICRO_MAX_ACTIVE_NEIGHBORS; i++) {
      if (entityDistances[i].dist < maxDistance * 2) {
        activeIds.add(entityDistances[i].id);
      }
    }

    microActiveIds = activeIds;
  }

  /**
   * Find closest entity to mouse/viewport center.
   * Used when entering MICRO mode without a selection.
   */
  function findClosestEntity(): number | null {
    if (!viewport) return null;

    const referencePoint = mouseWorldPos ?? viewport.center;
    let closest: { id: number; dist: number } | null = null;

    for (const entity of world.filteredEntities) {
      const pos = getEntityPosition(entity);
      const dx = pos.x - referencePoint.x;
      const dy = pos.y - referencePoint.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (!closest || dist < closest.dist) {
        closest = { id: entity.id, dist };
      }
    }

    const maxDistance = 200 / viewport.scale.x;
    return closest && closest.dist <= maxDistance ? closest.id : null;
  }

  /**
   * Exit micro view and reset state.
   * Called on: Escape key, click empty space, zoom out below threshold.
   * @param zoomOut - If true, also zoom the viewport out to detail level
   */
  function exitMicroView(zoomOut = false) {
    lastSelectedPosition = null;
    isAnimatingToSelected = false;
    microViewExitTime = performance.now();
    hideSelectedCard();

    // Zoom out to detail level if requested
    if (zoomOut && viewport) {
      viewport.animate({
        scale: SCALE_THRESHOLDS.detail + 0.5,
        time: 200,
        ease: "easeOutQuad",
      });
    }
  }

  /**
   * Check if two rectangles overlap (for viewport culling).
   */
  function boundsOverlap(
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number }
  ): boolean {
    return !(
      a.x + a.width < b.x ||
      a.x > b.x + b.width ||
      a.y + a.height < b.y ||
      a.y > b.y + b.height
    );
  }

  /**
   * Compute clusters for MESO level using grid-based spatial hashing.
   * O(n) complexity - efficient for real-time rendering.
   */
  function computeClusters(): ClusterData {
    const clusterMap = new Map<string, MesoCluster>();

    for (const entity of world.filteredEntities) {
      const pos = getEntityPosition(entity);
      const cellX = Math.floor(pos.x / MESO_GRID_SIZE);
      const cellY = Math.floor(pos.y / MESO_GRID_SIZE);
      const key = `${cellX},${cellY}`;

      if (!clusterMap.has(key)) {
        clusterMap.set(key, {
          cellX,
          cellY,
          worldX: (cellX + 0.5) * MESO_GRID_SIZE,
          worldY: (cellY + 0.5) * MESO_GRID_SIZE,
          entityIds: [],
          count: 0,
          dominantArchetype: [],
          dominantColor: 0x666666,
          archetypeBreakdown: new Map(),
        });
      }

      const cluster = clusterMap.get(key)!;
      cluster.entityIds.push(entity.id);
      cluster.count++;

      // Track archetype distribution
      const archetypeKey = getArchetypeKey(entity.archetype);
      cluster.archetypeBreakdown.set(
        archetypeKey,
        (cluster.archetypeBreakdown.get(archetypeKey) ?? 0) + 1
      );
    }

    // Compute dominant archetype and color for each cluster
    for (const cluster of clusterMap.values()) {
      let maxCount = 0;
      let dominant = "";
      for (const [archetype, count] of cluster.archetypeBreakdown) {
        if (count > maxCount) {
          maxCount = count;
          dominant = archetype;
        }
      }
      cluster.dominantArchetype = dominant ? dominant.split(",") : [];
      cluster.dominantColor =
        cluster.dominantArchetype.length > 0
          ? getArchetypeColor(cluster.dominantArchetype)
          : 0x666666;
    }

    return {
      tick: world.tick,
      clusters: Array.from(clusterMap.values()),
      totalEntities: world.entityCount,
    };
  }

  /**
   * Compute density grid for MACRO level.
   */
  function computeDensity(): DensityData {
    const cellWidth = WORLD_SIZE / MACRO_GRID_COLS;
    const cellHeight = WORLD_SIZE / MACRO_GRID_ROWS;

    // Initialize grids
    const countGrid: number[][] = Array(MACRO_GRID_ROWS)
      .fill(null)
      .map(() => Array(MACRO_GRID_COLS).fill(0));

    const archetypeGrid: Map<string, number>[][] = Array(MACRO_GRID_ROWS)
      .fill(null)
      .map(() =>
        Array(MACRO_GRID_COLS)
          .fill(null)
          .map(() => new Map())
      );

    // Accumulate entities into grid
    for (const entity of world.filteredEntities) {
      const pos = getEntityPosition(entity);
      const cellX = Math.min(MACRO_GRID_COLS - 1, Math.max(0, Math.floor(pos.x / cellWidth)));
      const cellY = Math.min(MACRO_GRID_ROWS - 1, Math.max(0, Math.floor(pos.y / cellHeight)));

      countGrid[cellY][cellX]++;

      const archetypeKey = getArchetypeKey(entity.archetype);
      const archetypeMap = archetypeGrid[cellY][cellX];
      archetypeMap.set(archetypeKey, (archetypeMap.get(archetypeKey) ?? 0) + 1);
    }

    // Find max density for normalization
    let maxCount = 1;
    for (let y = 0; y < MACRO_GRID_ROWS; y++) {
      for (let x = 0; x < MACRO_GRID_COLS; x++) {
        maxCount = Math.max(maxCount, countGrid[y][x]);
      }
    }

    // Build density cells
    const cells: DensityCell[] = [];
    for (let y = 0; y < MACRO_GRID_ROWS; y++) {
      for (let x = 0; x < MACRO_GRID_COLS; x++) {
        const count = countGrid[y][x];
        if (count === 0) continue; // Skip empty cells

        // Find dominant archetype
        const archetypeMap = archetypeGrid[y][x];
        let dominantArchetype: string[] | null = null;
        let maxArchetypeCount = 0;

        for (const [archetype, archetypeCount] of archetypeMap) {
          if (archetypeCount > maxArchetypeCount) {
            maxArchetypeCount = archetypeCount;
            dominantArchetype = archetype.split(",");
          }
        }

        cells.push({
          cellX: x,
          cellY: y,
          worldBounds: {
            x: x * cellWidth,
            y: y * cellHeight,
            width: cellWidth,
            height: cellHeight,
          },
          count,
          density: count / maxCount,
          dominantArchetype,
          dominantColor: dominantArchetype ? getArchetypeColor(dominantArchetype) : 0x666666,
        });
      }
    }

    return {
      tick: world.tick,
      cells,
      maxDensity: maxCount,
      totalEntities: world.entityCount,
    };
  }

  /**
   * Update visible entity count and zoom level.
   */
  function updateZoomLevel() {
    if (!viewport) return;

    // Count visible entities
    let count = 0;
    for (const entity of world.filteredEntities) {
      const pos = getEntityPosition(entity);
      if (isEntityVisible(pos)) {
        count++;
      }
    }
    visibleEntityCount = count;

    const scale = viewport.scale.x;
    const previousLevel = currentZoomLevel;

    // Calculate new zoom level
    const inCooldown = performance.now() - microViewExitTime < MICRO_VIEW_COOLDOWN_MS;
    const hasSelection = world.selectedEntityId !== null;
    const canEnterMicro = (hasSelection || findClosestEntity() !== null) && !inCooldown;
    const newLevel = calculateZoomLevel(scale, canEnterMicro);

    // Handle zoom level transitions
    if (newLevel === "micro" && previousLevel !== "micro") {
      // Entering MICRO mode: select closest entity if nothing selected
      if (!hasSelection) {
        const closest = findClosestEntity();
        if (closest !== null) {
          world.selectEntity(closest);
        }
      }

      // Center on selected entity
      const selectedId = world.selectedEntityId;
      if (selectedId !== null) {
        const selectedEntity = world.getEntity(selectedId);
        if (selectedEntity) {
          const pos = getEntityPosition(selectedEntity);
          lastSelectedPosition = { x: pos.x, y: pos.y };
          isAnimatingToSelected = true;
          viewport.animate({
            position: pos,
            time: 200,
            ease: "easeOutQuad",
            callbackOnComplete: () => {
              isAnimatingToSelected = false;
            },
          });
        }
      }
    } else if (previousLevel === "micro" && newLevel !== "micro") {
      // Exiting MICRO mode via zoom out
      exitMicroView();
    } else if (newLevel === "micro" && world.selectedEntityId !== null) {
      // In MICRO mode: follow selected entity if it moved
      if (!isAnimatingToSelected) {
        const selectedEntity = world.getEntity(world.selectedEntityId);
        if (selectedEntity) {
          const pos = getEntityPosition(selectedEntity);
          if (
            lastSelectedPosition &&
            (Math.abs(pos.x - lastSelectedPosition.x) > 1 ||
              Math.abs(pos.y - lastSelectedPosition.y) > 1)
          ) {
            isAnimatingToSelected = true;
            viewport.animate({
              position: pos,
              time: 100,
              ease: "easeOutQuad",
              callbackOnComplete: () => {
                isAnimatingToSelected = false;
              },
            });
          }
          lastSelectedPosition = { x: pos.x, y: pos.y };
        }
      }
    }

    // Compute active IDs for micro mode fog-of-war
    if (newLevel === "micro") {
      computeMicroActiveIds();
    }

    currentZoomLevel = newLevel;
  }

  /**
   * Get entity position from Position component, or generate based on ID.
   */
  function getEntityPosition(entity: EntitySnapshot): { x: number; y: number } {
    const posComponent = entity.components.find((c) => c.type_short === "Position");
    if (posComponent && typeof posComponent.data.x === "number") {
      // Map position to world coordinates (center of world + offset)
      const x = posComponent.data.x as number;
      const y = (posComponent.data.y as number | undefined) ?? 0;
      return {
        x: WORLD_SIZE / 2 + x * 5,
        y: WORLD_SIZE / 2 + y * 5,
      };
    }
    // Fallback: arrange in a grid based on entity ID
    const cols = Math.ceil(Math.sqrt(world.entityCount || 1));
    const row = Math.floor(entity.id / cols);
    const col = entity.id % cols;
    return {
      x: WORLD_SIZE / 2 - (cols * 30) / 2 + col * 30,
      y: WORLD_SIZE / 2 - (cols * 30) / 2 + row * 30,
    };
  }

  /**
   * Initialize PixiJS application and viewport.
   */
  async function initPixi() {
    if (!container) return;

    let rect = container.getBoundingClientRect();

    // Wait for container to have valid dimensions (flex layout may not be ready)
    if (rect.width === 0 || rect.height === 0) {
      await new Promise<void>((resolve) => {
        const observer = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(container);
      });
      rect = container.getBoundingClientRect();
    }

    // Create PixiJS application
    app = new Application();
    await app.init({
      width: rect.width,
      height: rect.height,
      backgroundColor: 0x1a1a2e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    container.appendChild(app.canvas as HTMLCanvasElement);

    // Create viewport for pan/zoom
    viewport = new Viewport({
      screenWidth: rect.width,
      screenHeight: rect.height,
      worldWidth: WORLD_SIZE,
      worldHeight: WORLD_SIZE,
      events: app.renderer.events,
    });

    app.stage.addChild(viewport);

    // Enable drag and pinch/wheel zoom
    viewport
      .drag()
      .pinch()
      .wheel()
      .decelerate()
      .clampZoom({
        minScale: 0.1,
        maxScale: 4,
      });

    viewport.moveCenter(WORLD_SIZE / 2, WORLD_SIZE / 2);

    drawWorldBounds();

    // Create entity container (for DETAIL and MICRO levels)
    entityContainer = new Container();
    entityContainer.label = "entities";
    viewport.addChild(entityContainer);

    // Create MESO container (for clustered view)
    mesoContainer = new Container();
    mesoContainer.label = "meso";
    mesoContainer.visible = false;
    viewport.addChild(mesoContainer);

    // Create MACRO container (for density view)
    macroContainer = new Container();
    macroContainer.label = "macro";
    macroContainer.visible = false;
    viewport.addChild(macroContainer);

    // Create tooltip (fixed to screen, not world)
    const tooltipStyle = new TextStyle({
      fontFamily: "monospace",
      fontSize: 12,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 2 },
    });
    tooltipText = new Text({ text: "", style: tooltipStyle });
    tooltipText.visible = false;
    app.stage.addChild(tooltipText);

    // Track mouse position in world coordinates
    viewport.on("pointermove", (e) => {
      if (viewport) {
        const worldPos = viewport.toWorld(e.global.x, e.global.y);
        mouseWorldPos = { x: worldPos.x, y: worldPos.y };
      }
    });

    viewport.on("pointerleave", () => {
      mouseWorldPos = null;
    });

    // Update entities when viewport changes
    // Note: renderEntities() calls updateZoomLevel() at the end
    viewport.on("zoomed", () => {
      renderEntities();
    });
    viewport.on("moved-end", () => {
      renderEntities();
    });

    // Click on empty space exits micro view
    // This fires when clicking on the viewport background, not on entities
    // pixi-viewport's clicked event provides { screen, world, viewport }
    viewport.on("clicked", (e: { world: { x: number; y: number } }) => {
      if (currentZoomLevel !== "micro" || world.selectedEntityId === null) return;

      // Check if click was on an entity by checking if any entity is under the cursor
      const worldPos = e.world;
      const clickedOnEntity = world.filteredEntities.some((entity) => {
        const pos = getEntityPosition(entity);
        const radius = getEntityRadius(entity, currentZoomLevel) * getScreenSpaceScale();
        const dx = worldPos.x - pos.x;
        const dy = worldPos.y - pos.y;
        return Math.sqrt(dx * dx + dy * dy) <= radius * 1.5; // Slight tolerance
      });

      if (!clickedOnEntity) {
        world.selectEntity(null);
        exitMicroView(true);
        renderEntities();
      }
    });

    // Animation ticker
    let lastTime = performance.now();
    app.ticker.add(() => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      updateAnimations(delta);
    });

    // Mark PixiJS as ready - this will trigger the effect to render entities
    isPixiReady = true;
  }

  /**
   * Draw world boundary box.
   */
  function drawWorldBounds() {
    if (!viewport) return;

    gridGraphics = new Graphics();
    gridGraphics.label = "bounds";

    // Draw boundary rectangle
    gridGraphics.rect(0, 0, WORLD_SIZE, WORLD_SIZE);
    gridGraphics.stroke({ width: 2, color: GRID_COLOR, alpha: GRID_ALPHA });

    // Origin marker at center
    gridGraphics.circle(WORLD_SIZE / 2, WORLD_SIZE / 2, 4);
    gridGraphics.fill({ color: 0x4a4a5a });

    viewport.addChildAt(gridGraphics, 0);
  }

  /**
   * Handle container resize.
   */
  function handleResize() {
    if (!app || !viewport || !container) return;

    const rect = container.getBoundingClientRect();
    app.renderer.resize(rect.width, rect.height);
    viewport.resize(rect.width, rect.height);
  }

  /**
   * Zoom to a cluster center (from MESO to DETAIL).
   */
  function zoomToCluster(cluster: MesoCluster) {
    if (!viewport) return;

    viewport.animate({
      position: { x: cluster.worldX, y: cluster.worldY },
      scale: SCALE_THRESHOLDS.detail + 0.5,
      time: 400,
      ease: "easeOutQuad",
    });
  }

  /**
   * Zoom to a density cell center (from MACRO to MESO).
   */
  function zoomToDensityCell(cell: DensityCell) {
    if (!viewport) return;

    const bounds = cell.worldBounds;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    viewport.animate({
      position: { x: centerX, y: centerY },
      scale: SCALE_THRESHOLDS.meso + 0.2,
      time: 400,
      ease: "easeOutQuad",
    });
  }

  /**
   * Format archetype for display (short names only).
   */
  function formatArchetype(archetype: string[]): string {
    return archetype.map((s) => s.split(".").pop()).join(", ");
  }

  /**
   * Get top archetypes from density data for legend.
   */
  function getTopArchetypes(): { archetype: string[]; count: number; color: number }[] {
    if (!densityData) return [];

    const archetypeCounts = new Map<string, number>();
    for (const cell of densityData.cells) {
      if (cell.dominantArchetype) {
        const key = cell.dominantArchetype.join(",");
        archetypeCounts.set(key, (archetypeCounts.get(key) ?? 0) + cell.count);
      }
    }

    return Array.from(archetypeCounts.entries())
      .map(([key, count]) => ({
        archetype: key.split(","),
        count,
        color: getArchetypeColor(key.split(",")),
      }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Render cluster label with count and interaction.
   */
  function renderClusterLabel(cluster: MesoCluster) {
    if (!mesoContainer || !tooltipText) return;

    const label = new Container();

    // Background pill
    const width = 40 + cluster.count.toString().length * 8;
    const height = 22;
    const bg = new Graphics();
    bg.roundRect(-width / 2, -height / 2, width, height, 6);
    bg.fill({ color: 0x1a1a2e, alpha: 0.9 });
    bg.stroke({ width: 1, color: cluster.dominantColor, alpha: 0.6 });
    label.addChild(bg);

    // Count text
    const countStyle = new TextStyle({
      fontFamily: "monospace",
      fontSize: 11,
      fontWeight: "bold",
      fill: cluster.dominantColor,
    });
    const countText = new Text({
      text: cluster.count.toString(),
      style: countStyle,
    });
    countText.anchor.set(0.5, 0.5);
    label.addChild(countText);

    // Position at cluster center (slightly above center)
    label.x = cluster.worldX;
    label.y = cluster.worldY - 20;

    // Interactive
    label.eventMode = "static";
    label.cursor = "pointer";

    // Store cluster reference for event handlers
    (label as Container & { cluster: MesoCluster }).cluster = cluster;

    label.on("pointerover", (e) => {
      if (!tooltipText) return;
      const c = (e.currentTarget as Container & { cluster: MesoCluster }).cluster;
      // Show archetype breakdown
      const breakdown = Array.from(c.archetypeBreakdown.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([arch, cnt]) => `${formatArchetype(arch.split(","))} (${cnt})`)
        .join("\n");
      tooltipText.text = `Cluster: ${c.count} entities\n${breakdown}`;
      tooltipText.visible = true;
      tooltipText.x = e.global.x + 10;
      tooltipText.y = e.global.y + 10;
    });

    label.on("pointerout", () => {
      if (tooltipText) tooltipText.visible = false;
    });

    label.on("pointertap", (e) => {
      const c = (e.currentTarget as Container & { cluster: MesoCluster }).cluster;
      zoomToCluster(c);
    });

    mesoContainer.addChild(label);
  }

  /**
   * Render MESO level: dots with cluster labels.
   */
  function renderMesoLevel() {
    if (!viewport || !mesoContainer || !tooltipText) return;

    // Ensure cluster data is current
    if (!clusterData || clusterData.tick !== world.tick) {
      clusterData = computeClusters();
    }

    // Clear and destroy previous frame's graphics to prevent GPU memory leaks
    while (mesoContainer.children.length > 0) {
      const child = mesoContainer.children[0];
      mesoContainer.removeChild(child);
      child.destroy({ children: true });
    }

    const visibleBounds = viewport.getVisibleBounds();

    for (const cluster of clusterData.clusters) {
      // Viewport culling for cluster
      const clusterBounds = {
        x: cluster.cellX * MESO_GRID_SIZE,
        y: cluster.cellY * MESO_GRID_SIZE,
        width: MESO_GRID_SIZE,
        height: MESO_GRID_SIZE,
      };

      if (!boundsOverlap(clusterBounds, visibleBounds)) continue;

      // Render individual dots for this cluster
      for (const entityId of cluster.entityIds) {
        const entity = world.getEntity(entityId);
        if (!entity) continue;

        const pos = getEntityPosition(entity);
        if (!isEntityVisible(pos)) continue;

        const color = getArchetypeColor(entity.archetype);
        const isSelected = world.selectedEntityId === entityId;
        const isChanged = world.isChangedEntity(entityId);

        const dot = new Graphics();
        dot.circle(0, 0, MESO_RADIUS);
        dot.fill({ color, alpha: 0.7 });

        // Selection ring
        if (isSelected) {
          dot.circle(0, 0, MESO_RADIUS + 2);
          dot.stroke({ width: 1, color: 0xffffff });
        }

        // Change indicator (yellow ring)
        if (isChanged) {
          dot.circle(0, 0, MESO_RADIUS + 1);
          dot.stroke({ width: 1, color: 0xfbbf24, alpha: 0.6 });
        }

        dot.x = pos.x;
        dot.y = pos.y;
        dot.eventMode = "static";
        dot.cursor = "pointer";

        // Store entity ID for handlers
        (dot as Graphics & { entityId: number }).entityId = entityId;

        // Hover handler
        dot.on("pointerover", (e) => {
          if (!tooltipText) return;
          const eid = (e.currentTarget as Graphics & { entityId: number }).entityId;
          const ent = world.getEntity(eid);
          if (ent) {
            tooltipText.text = `Entity ${eid}`;
            tooltipText.visible = true;
          }
        });
        dot.on("pointermove", (e) => {
          if (tooltipText) {
            tooltipText.x = e.global.x + 10;
            tooltipText.y = e.global.y + 10;
          }
        });
        dot.on("pointerout", () => {
          if (tooltipText) tooltipText.visible = false;
        });

        // Click handler
        dot.on("pointertap", (e) => {
          const eid = (e.currentTarget as Graphics & { entityId: number }).entityId;
          world.selectEntity(world.selectedEntityId === eid ? null : eid);
        });

        mesoContainer.addChild(dot);
      }

      // Render cluster label if threshold met
      if (cluster.count >= CLUSTER_LABEL_THRESHOLD) {
        renderClusterLabel(cluster);
      }
    }
  }

  /**
   * Render MACRO level: density heat map.
   */
  function renderMacroLevel() {
    if (!viewport || !macroContainer || !tooltipText) return;

    // Ensure density data is current
    if (!densityData || densityData.tick !== world.tick) {
      densityData = computeDensity();
    }

    // Clear and destroy previous frame's graphics to prevent GPU memory leaks
    while (macroContainer.children.length > 0) {
      const child = macroContainer.children[0];
      macroContainer.removeChild(child);
      child.destroy({ children: true });
    }

    const visibleBounds = viewport.getVisibleBounds();

    for (const cell of densityData.cells) {
      // Viewport culling
      if (!boundsOverlap(cell.worldBounds, visibleBounds)) continue;

      const cellGfx = new Graphics();
      const bounds = cell.worldBounds;

      // Map density to alpha
      const alpha =
        MACRO_CELL_MIN_ALPHA + cell.density * (MACRO_CELL_MAX_ALPHA - MACRO_CELL_MIN_ALPHA);

      // Draw filled rect
      cellGfx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      cellGfx.fill({ color: cell.dominantColor, alpha });

      // Subtle border
      cellGfx.stroke({ width: 1, color: cell.dominantColor, alpha: 0.3 });

      // Interactive
      cellGfx.eventMode = "static";
      cellGfx.cursor = "pointer";

      // Store cell reference
      (cellGfx as Graphics & { densityCell: DensityCell }).densityCell = cell;

      cellGfx.on("pointerover", (e) => {
        if (!tooltipText) return;
        const c = (e.currentTarget as Graphics & { densityCell: DensityCell }).densityCell;
        const archetypeStr = c.dominantArchetype ? formatArchetype(c.dominantArchetype) : "Mixed";
        tooltipText.text = `Region: ${c.count} entities\nDominant: ${archetypeStr}`;
        tooltipText.visible = true;
        tooltipText.x = e.global.x + 10;
        tooltipText.y = e.global.y + 10;
      });

      cellGfx.on("pointerout", () => {
        if (tooltipText) tooltipText.visible = false;
      });

      cellGfx.on("pointertap", (e) => {
        const c = (e.currentTarget as Graphics & { densityCell: DensityCell }).densityCell;
        zoomToDensityCell(c);
      });

      macroContainer.addChild(cellGfx);
    }
  }

  /**
   * Create or update entity graphics.
   */
  function renderEntities() {
    if (!entityContainer || !viewport) return;

    // Update zoom level FIRST (before using currentZoomLevel for decisions)
    updateZoomLevel();

    // Toggle container visibility based on zoom level
    if (entityContainer) {
      entityContainer.visible = currentZoomLevel === "micro" || currentZoomLevel === "detail";
    }
    if (mesoContainer) {
      mesoContainer.visible = currentZoomLevel === "meso";
    }
    if (macroContainer) {
      macroContainer.visible = currentZoomLevel === "macro";
    }

    // Render based on zoom level
    switch (currentZoomLevel) {
      case "macro":
        renderMacroLevel();
        return; // Early return - don't process individual entities
      case "meso":
        renderMesoLevel();
        return; // Early return
      case "micro":
      case "detail":
        // Continue to existing entity rendering code below
        break;
    }

    const currentIds = new Set<number>();

    for (const entity of world.filteredEntities) {
      currentIds.add(entity.id);
      let gfx = entityGraphics.get(entity.id);

      if (!gfx) {
        gfx = new Graphics();
        gfx.eventMode = "static";
        gfx.cursor = "pointer";

        // Store entity ID for event handlers
        (gfx as Graphics & { entityId: number }).entityId = entity.id;

        // Hover handlers
        gfx.on("pointerover", (e) => {
          if (!tooltipText || !app) return;
          const eid = (e.currentTarget as Graphics & { entityId: number }).entityId;
          const ent = world.getEntity(eid);
          if (ent) {
            tooltipText.text = `Entity ${eid}\n${ent.archetype.join(", ")}`;
            tooltipText.visible = true;
          }
        });

        gfx.on("pointermove", (e) => {
          if (!tooltipText) return;
          tooltipText.x = e.global.x + 10;
          tooltipText.y = e.global.y + 10;
        });

        gfx.on("pointerout", () => {
          if (tooltipText) tooltipText.visible = false;
        });

        // Click handler - select/deselect entity
        gfx.on("pointertap", (e) => {
          const eid = (e.currentTarget as Graphics & { entityId: number }).entityId;
          const isAlreadySelected = world.selectedEntityId === eid;

          if (isAlreadySelected) {
            // Deselect
            world.selectEntity(null);
          } else {
            // Select new entity
            world.selectEntity(eid);

            // In micro view, animate to newly selected entity
            if (currentZoomLevel === "micro" && viewport) {
              const clickedEntity = world.getEntity(eid);
              if (clickedEntity) {
                const pos = getEntityPosition(clickedEntity);
                lastSelectedPosition = { x: pos.x, y: pos.y };
                isAnimatingToSelected = true;
                viewport.animate({
                  position: pos,
                  time: 200,
                  ease: "easeOutQuad",
                  callbackOnComplete: () => {
                    isAnimatingToSelected = false;
                  },
                });
              }
            }
          }
        });

        entityContainer.addChild(gfx);
        entityGraphics.set(entity.id, gfx);

        // Start spawn animation
        entityAnimations.set(entity.id, { type: "spawn", progress: 0 });
        gfx.scale.set(0);
        gfx.alpha = 0;
      } else if (world.isChangedEntity(entity.id) && !entityAnimations.has(entity.id)) {
        // Start pulse animation for changed entities
        entityAnimations.set(entity.id, { type: "pulse", progress: 0 });
      }

      const pos = getEntityPosition(entity);
      gfx.x = pos.x;
      gfx.y = pos.y;

      // Get screen-space scale factor (1 for world-space, inverse scale for MICRO)
      const ssScale = getScreenSpaceScale();

      // Redraw circle based on zoom level
      // In MICRO mode, multiply radius by ssScale to get fixed screen size
      const baseRadius = getEntityRadius(entity, currentZoomLevel);
      const radius = currentZoomLevel === "micro" ? baseRadius * ssScale : baseRadius;
      const color = getArchetypeColor(entity.archetype);
      const isSelected = world.selectedEntityId === entity.id;
      const isNew = world.isNewEntity(entity.id);
      const isChanged = world.isChangedEntity(entity.id);

      gfx.clear();

      // Render based on current zoom level (only micro and detail reach here)
      if (currentZoomLevel === "micro") {
        // MICRO mode: fixed screen-space sizes, fog-of-war for non-active entities
        const isActive = microActiveIds.has(entity.id);

        if (isActive) {
          // Active entities: full color and detail
          gfx.circle(0, 0, radius);
          gfx.fill({ color, alpha: isSelected ? 1.0 : 0.85 });

          // Selection ring (white)
          if (isSelected) {
            gfx.circle(0, 0, radius + 4 * ssScale);
            gfx.stroke({ width: 2 * ssScale, color: 0xffffff });
          }
        } else {
          // Fog of war: dimmed, smaller, desaturated
          const fogRadius = radius * 0.7;
          // Desaturate color by mixing with gray
          const gray = 0x404050;
          const fogColor = blendColors(color, gray, 0.6);
          gfx.circle(0, 0, fogRadius);
          gfx.fill({ color: fogColor, alpha: 0.3 });
        }
      } else {
        // DETAIL level
        gfx.circle(0, 0, radius);
        gfx.fill({ color, alpha: 0.8 });

        if (isSelected) {
          gfx.circle(0, 0, radius + 3);
          gfx.stroke({ width: 2, color: 0xffffff });
        }

        // New/changed indicator
        if (isNew) {
          gfx.circle(0, 0, radius + 2);
          gfx.stroke({ width: 2, color: 0x22c55e, alpha: 0.8 });
        } else if (isChanged) {
          gfx.circle(0, 0, radius + 2);
          gfx.stroke({ width: 1, color: 0xfbbf24, alpha: 0.6 });
        }
      }

      // Micro level: show card only for selected entity
      if (currentZoomLevel === "micro" && entity.id === world.selectedEntityId) {
        renderSelectedCard(entity, pos);
      }
    }

    // Start destroy animation for removed entities
    for (const [id, gfx] of entityGraphics) {
      if (!currentIds.has(id)) {
        const anim = entityAnimations.get(id);
        if (!anim || anim.type !== "destroy") {
          // Start destroy animation
          entityAnimations.set(id, { type: "destroy", progress: 0 });
        }
      }
    }
  }

  // Selected entity card container (reused)
  let selectedCardContainer: Container | null = null;

  /**
   * Render info card for selected entity in micro view.
   * Card is rendered in screen-space (added to stage, not viewport).
   */
  function renderSelectedCard(entity: EntitySnapshot, worldPos: { x: number; y: number }) {
    if (!viewport || !app) return;

    // Create or reuse card container (on stage for true screen-space)
    if (!selectedCardContainer) {
      selectedCardContainer = new Container();
      selectedCardContainer.label = "selected-card";
      app.stage.addChild(selectedCardContainer);
    }

    selectedCardContainer.visible = true;

    // Destroy old children to prevent GPU memory leaks
    while (selectedCardContainer.children.length > 0) {
      const child = selectedCardContainer.children[0];
      selectedCardContainer.removeChild(child);
      child.destroy({ children: true });
    }

    // Convert world position to screen position
    const screenPos = viewport.toScreen(worldPos.x, worldPos.y);
    selectedCardContainer.x = screenPos.x;
    selectedCardContainer.y = screenPos.y;

    // All dimensions in screen pixels
    const padding = 8;
    const lineHeight = 16;
    const headerHeight = 26;
    const cardWidth = 180;
    const cornerRadius = 6;

    // Font sizes in screen pixels
    const headerFontSize = 11;
    const compFontSize = 10;
    const metricFontSize = 9;

    const contentHeight = entity.components.length * lineHeight + padding;
    const cardHeight = headerHeight + contentHeight + padding;

    const cardY = -35 - cardHeight;

    const bg = new Graphics();
    bg.roundRect(-cardWidth / 2, cardY, cardWidth, cardHeight, cornerRadius);
    bg.fill({ color: 0x1a1a2e, alpha: 0.95 });
    bg.stroke({ color: 0x4f8eff, width: 2, alpha: 0.9 });
    selectedCardContainer.addChild(bg);

    const headerGfx = new Graphics();
    headerGfx.roundRect(
      -cardWidth / 2 + 2,
      cardY + 2,
      cardWidth - 4,
      headerHeight - 2,
      cornerRadius - 2
    );
    headerGfx.fill({ color: 0x2a2a4e, alpha: 0.8 });
    selectedCardContainer.addChild(headerGfx);

    const archetypeShort = entity.archetype
      .map((c) => c.split(".").pop() || c)
      .slice(0, 2)
      .join("+");
    const headerText = `#${entity.id} · ${archetypeShort}`;

    const headerStyle = new TextStyle({
      fontFamily: "monospace",
      fontSize: headerFontSize,
      fontWeight: "bold",
      fill: 0xffffff,
    });
    const headerLabel = new Text({ text: headerText, style: headerStyle });
    headerLabel.anchor.set(0.5, 0.5);
    headerLabel.y = cardY + headerHeight / 2;
    selectedCardContainer.addChild(headerLabel);

    const compStyle = new TextStyle({
      fontFamily: "monospace",
      fontSize: compFontSize,
      fill: 0xdddddd,
    });
    const metricStyle = new TextStyle({
      fontFamily: "monospace",
      fontSize: metricFontSize,
      fill: 0x999999,
    });

    const contentStartY = cardY + headerHeight + padding / 2;
    const leftX = -cardWidth / 2 + padding;

    for (let i = 0; i < entity.components.length; i++) {
      const comp = entity.components[i];
      const rowY = contentStartY + i * lineHeight + lineHeight / 2;

      const compLabel = new Text({ text: comp.type_short, style: compStyle });
      compLabel.anchor.set(0, 0.5);
      compLabel.x = leftX;
      compLabel.y = rowY;
      selectedCardContainer.addChild(compLabel);

      const metric = getKeyMetric(comp);
      if (metric) {
        const metricLabel = new Text({ text: metric, style: metricStyle });
        metricLabel.anchor.set(1, 0.5);
        metricLabel.x = cardWidth / 2 - padding;
        metricLabel.y = rowY;
        selectedCardContainer.addChild(metricLabel);
      }
    }
  }

  /**
   * Hide the selected entity card when not in micro view.
   */
  function hideSelectedCard() {
    if (selectedCardContainer) {
      selectedCardContainer.visible = false;
    }
  }

  /**
   * Extract a key metric from a component for display.
   */
  function getKeyMetric(comp: { type_short: string; data: Record<string, unknown> }): string | null {
    const data = comp.data;

    // Common patterns for key metrics
    if ("x" in data && "y" in data) {
      const x = typeof data.x === "number" ? data.x.toFixed(0) : "?";
      const y = typeof data.y === "number" ? data.y.toFixed(0) : "?";
      return `(${x}, ${y})`;
    }
    if ("status" in data && typeof data.status === "string") {
      return data.status;
    }
    if ("state" in data && typeof data.state === "string") {
      return data.state;
    }
    if ("level" in data && typeof data.level === "number") {
      return `lvl ${data.level}`;
    }
    if ("count" in data && typeof data.count === "number") {
      return `×${data.count}`;
    }
    if ("name" in data && typeof data.name === "string") {
      return data.name.length > 10 ? data.name.slice(0, 10) + "…" : data.name;
    }

    return null;
  }

  /**
   * Update animations each frame.
   */
  function updateAnimations(deltaMs: number) {
    if (!entityContainer) return;

    const toRemove: number[] = [];

    for (const [id, anim] of entityAnimations) {
      const gfx = entityGraphics.get(id);
      if (!gfx) {
        toRemove.push(id);
        continue;
      }

      let duration: number;
      switch (anim.type) {
        case "spawn":
          duration = SPAWN_DURATION;
          break;
        case "destroy":
          duration = DESTROY_DURATION;
          break;
        case "pulse":
          duration = PULSE_DURATION;
          break;
      }

      anim.progress += deltaMs / duration;

      if (anim.progress >= 1) {
        // Animation complete
        if (anim.type === "destroy") {
          // Actually remove the entity
          entityContainer.removeChild(gfx);
          gfx.destroy();
          entityGraphics.delete(id);
        } else {
          // Reset to normal state
          gfx.scale.set(1);
          gfx.alpha = 1;
        }
        toRemove.push(id);
      } else {
        const t = anim.progress;
        switch (anim.type) {
          case "spawn":
            // Ease out: scale and fade in
            const easeOut = 1 - Math.pow(1 - t, 3);
            gfx.scale.set(easeOut);
            gfx.alpha = easeOut;
            break;
          case "destroy":
            // Ease in: scale and fade out
            const easeIn = 1 - t;
            gfx.scale.set(easeIn);
            gfx.alpha = easeIn * easeIn;
            break;
          case "pulse":
            // Pulse: scale up then back
            const pulse = Math.sin(t * Math.PI);
            gfx.scale.set(1 + pulse * 0.2);
            break;
        }
      }
    }

    for (const id of toRemove) {
      entityAnimations.delete(id);
    }
  }

  // Reactive effect to update entities when world changes or PixiJS initializes
  $effect(() => {
    // Access reactive state to trigger effect
    const _ = world.filteredEntities;
    const __ = world.selectedEntityId;
    const ___ = isPixiReady;

    // Only render when PixiJS is ready
    if (isPixiReady) {
      renderEntities();
    }
  });

  /**
   * Zoom in by a factor.
   */
  function zoomIn() {
    if (!viewport) return;
    const currentScale = viewport.scale.x;
    const newScale = Math.min(currentScale * 1.5, 4);
    viewport.animate({
      scale: newScale,
      time: 200,
      ease: "easeOutQuad",
    });
  }

  /**
   * Zoom out by a factor.
   */
  function zoomOut() {
    if (!viewport) return;
    const currentScale = viewport.scale.x;
    const newScale = Math.max(currentScale / 1.5, 0.1);
    viewport.animate({
      scale: newScale,
      time: 200,
      ease: "easeOutQuad",
    });
  }

  /**
   * Reset zoom to fit all entities in view.
   */
  function resetZoom() {
    if (!viewport) return;
    viewport.animate({
      scale: 1,
      position: { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 },
      time: 300,
      ease: "easeOutQuad",
    });
  }

  function zoomToDetail() {
    if (!viewport) return;
    viewport.animate({
      scale: 1.2,
      time: 300,
      ease: "easeOutQuad",
    });
  }

  function zoomToMeso() {
    if (!viewport) return;
    viewport.animate({
      scale: 0.5,
      time: 300,
      ease: "easeOutQuad",
    });
  }

  function zoomToMacro() {
    if (!viewport) return;
    viewport.animate({
      scale: 0.15,
      time: 300,
      ease: "easeOutQuad",
    });
  }

  function cleanup() {
    isPixiReady = false;

    // Destroy entity graphics before clearing map
    for (const gfx of entityGraphics.values()) {
      gfx.destroy();
    }
    entityGraphics.clear();
    entityAnimations.clear();

    // Clear MESO/MACRO state
    clusterData = null;
    densityData = null;
    mesoContainer = null;
    macroContainer = null;

    // Clear selected card container
    selectedCardContainer = null;

    if (app) {
      app.destroy(true, { children: true, texture: true });
      app = null;
    }
    viewport = null;
    gridGraphics = null;
    entityContainer = null;
    tooltipText = null;
  }

  onMount(() => {
    initPixi();

    // Set up resize observer
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && currentZoomLevel === "micro" && world.selectedEntityId !== null) {
        world.selectEntity(null);
        exitMicroView(true);
        renderEntities();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      resizeObserver.disconnect();
      document.removeEventListener("keydown", handleKeyDown);
      cleanup();
    };
  });

  onDestroy(() => {
    cleanup();
  });
</script>

<div class="petri-wrapper">
  <div
    bind:this={container}
    class="petri-container"
  ></div>

  <!-- Color legend (always visible) -->
  <div
    class="absolute top-3 left-3 px-3 py-2 rounded-md bg-black/70 backdrop-blur-sm
           text-xs font-mono text-[var(--color-text-secondary)] max-w-[220px]"
  >
    <div class="font-semibold text-[var(--color-text-primary)] mb-2">
      {#if world.archetypeFilter}
        <span class="text-[var(--color-accent)]">{world.filteredEntities.length}</span>
        <span class="text-[var(--color-text-muted)]">/ {world.entities.length}</span>
        <button
          class="ml-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          onclick={() => world.clearArchetypeFilter()}
          title="Clear filter"
        >(clear)</button>
      {:else}
        {world.entities.length} entities
      {/if}
    </div>
    <!-- Entity states (shown as rings, so use border style) -->
    <div class="mb-2 pb-2 border-b border-white/10">
      <div class="flex items-center gap-2 py-0.5">
        <span class="w-3 h-3 rounded-full shrink-0 border-2" style="border-color: #22c55e"></span>
        <span>Spawned</span>
      </div>
      <div class="flex items-center gap-2 py-0.5">
        <span class="w-3 h-3 rounded-full shrink-0 border-2" style="border-color: #ffffff"></span>
        <span>Selected</span>
      </div>
      <div class="flex items-center gap-2 py-0.5">
        <span class="w-3 h-3 rounded-full shrink-0 border-2" style="border-color: #fbbf24"></span>
        <span>Changed</span>
      </div>
    </div>
    <!-- Archetypes -->
    {#each visibleArchetypes.slice(0, 5) as { archetype, count, color }}
      <div class="flex items-center gap-2 py-0.5">
        <span
          class="w-3 h-3 rounded-sm shrink-0"
          style="background-color: #{color.toString(16).padStart(6, '0')}"
        ></span>
        <span class="truncate flex-1">{formatArchetype(archetype)}</span>
        <span class="text-[var(--color-text-muted)] shrink-0">({count})</span>
      </div>
    {/each}
  </div>

  <!-- Zoom level indicator -->
  <div
    class="absolute bottom-3 left-3 px-3 py-1.5 rounded-md bg-black/60 backdrop-blur-sm
           text-xs font-mono text-[var(--color-text-secondary)] flex items-center gap-2"
  >
    <span
      class="w-2 h-2 rounded-full"
      class:bg-violet-500={currentZoomLevel === "micro"}
      class:bg-blue-500={currentZoomLevel === "detail"}
      class:bg-teal-500={currentZoomLevel === "meso"}
      class:bg-orange-500={currentZoomLevel === "macro"}
    ></span>
    <span class="uppercase">{currentZoomLevel}</span>
    <span class="text-[var(--color-text-muted)]">({visibleEntityCount} visible)</span>
  </div>

  <!-- Zoom controls -->
  <div class="absolute bottom-3 right-3 flex items-end gap-2" role="group" aria-label="Zoom controls">
    <!-- Zoom level buttons -->
    <div class="flex gap-1">
      <button
        onclick={zoomToDetail}
        class="zoom-level-btn"
        class:active={currentZoomLevel === "detail" || currentZoomLevel === "micro"}
        title="Detail view"
        aria-label="Zoom to detail level"
      >D</button>
      <button
        onclick={zoomToMeso}
        class="zoom-level-btn"
        class:active={currentZoomLevel === "meso"}
        title="Meso view"
        aria-label="Zoom to meso level"
      >M</button>
      <button
        onclick={zoomToMacro}
        class="zoom-level-btn"
        class:active={currentZoomLevel === "macro"}
        title="Macro view"
        aria-label="Zoom to macro level"
      >O</button>
    </div>
    <!-- +/- zoom buttons -->
    <div class="flex flex-col gap-1">
      <button
        onclick={zoomIn}
        class="zoom-btn"
        title="Zoom in"
        aria-label="Zoom in"
      >
        <span aria-hidden="true">+</span>
      </button>
      <button
        onclick={resetZoom}
        class="zoom-btn text-xs"
        title="Reset view"
        aria-label="Reset zoom to fit all entities"
      >
        <span aria-hidden="true">⟲</span>
      </button>
      <button
        onclick={zoomOut}
        class="zoom-btn"
        title="Zoom out"
        aria-label="Zoom out"
      >
        <span aria-hidden="true">−</span>
      </button>
    </div>
  </div>
</div>

<style>
  .petri-wrapper {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 400px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .petri-container {
    flex: 1;
    min-height: 0;
    border-radius: 0.5rem;
    overflow: hidden;
    background-color: #1a1a2e;
  }

  .petri-container :global(canvas) {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }

  .zoom-btn {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background-color: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    color: var(--color-text-secondary);
    font-size: 16px;
    font-weight: 500;
    border: none;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
  }

  .zoom-btn:hover {
    background-color: rgba(0, 0, 0, 0.8);
    color: var(--color-text-primary);
  }

  .zoom-btn:active {
    background-color: rgba(79, 142, 255, 0.3);
  }

  .zoom-level-btn {
    padding: 4px 8px;
    border-radius: 4px;
    background-color: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    color: var(--color-text-secondary);
    font-size: 11px;
    font-weight: 600;
    font-family: ui-monospace, monospace;
    border: none;
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
  }

  .zoom-level-btn:hover {
    background-color: rgba(0, 0, 0, 0.8);
    color: var(--color-text-primary);
  }

  .zoom-level-btn.active {
    background-color: rgba(79, 142, 255, 0.4);
    color: var(--color-text-primary);
  }
</style>
