import { engine, PBUiCanvasInformation, UiCanvasInformation } from "@dcl/sdk/ecs"
import { isMobile } from "@dcl/sdk/platform"

export const [BASE_WIDTH, BASE_HEIGHT] = isMobile() ? [1600, 720] : [1920, 1080]

/** Last known canvas width, refreshed each frame from {@link UiCanvasInformation}. */
export let actualWidth  = BASE_WIDTH
/** Last known canvas height, refreshed each frame from {@link UiCanvasInformation}. */
export let actualHeight = BASE_HEIGHT


// MARK: getCanvasInfo
/**
 * Canvas dimensions when React/UI has mounted them on the root entity;
 * `null` on early frames (preview/worker) before {@link UiCanvasInformation} exists.
 */
export function getCanvasInfo(): PBUiCanvasInformation | null {
	return UiCanvasInformation.getOrNull(engine.RootEntity)
}


// MARK: readCanvasDimensions
/** Prefer live canvas size; fall back to last known or {@link BASE_WIDTH}/{@link BASE_HEIGHT}. */
export function readCanvasDimensions(): { height: number; width: number } {
	const canvasInfo = getCanvasInfo()
	if (canvasInfo) {
		return { height: canvasInfo.height, width: canvasInfo.width }
	}
	return { height: actualHeight, width: actualWidth }
}


// MARK: getCurrentCanvasSize
/** Same as {@link readCanvasDimensions}; convenient alias for layout code. */
export function getCurrentCanvasSize(): { height: number; width: number } {
	return readCanvasDimensions()
}

export function vhAsPixels(vh: number, min: number = 0, max: number = 99999): number {
	const height = readCanvasDimensions().height
	const value = Math.max(min, Math.min(max, (vh / 100) * height))
	return value
}

export function vwAsPixels(vw: number, min: number = 0, max: number = 99999): number {
	const width = readCanvasDimensions().width
	const value = Math.max(min, Math.min(max, (vw / 100) * width))
	return value
}


// MARK: pixelsScaledRelative
export function pixelsScaledRelative(
	value      : number,
	normalSize : number,
	currentSize: number
): number {
	return value * (currentSize / normalSize)
}



// MARK: system_updateCanvasSize
function sys_updateCanvasSize(_dt: number): void {
	const canvasInfo = getCanvasInfo()
	if (!canvasInfo) return

	if (actualWidth  !== canvasInfo.width)  actualWidth  = canvasInfo.width
	if (actualHeight !== canvasInfo.height) actualHeight = canvasInfo.height
}

engine.addSystem(sys_updateCanvasSize)

