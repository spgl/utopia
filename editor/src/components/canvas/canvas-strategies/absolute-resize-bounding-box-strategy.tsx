import { isHorizontalPoint } from 'utopia-api/core'
import { getLayoutProperty } from '../../../core/layout/getLayoutProperty'
import { framePointForPinnedProp } from '../../../core/layout/layout-helpers-new'
import { MetadataUtils } from '../../../core/model/element-metadata-utils'
import { mapDropNulls } from '../../../core/shared/array-utils'
import { isRight, right } from '../../../core/shared/either'
import { ElementInstanceMetadataMap, JSXElement } from '../../../core/shared/element-template'
import {
  CanvasRectangle,
  rectangleDifference,
  roundTo,
  transformFrameUsingBoundingBox,
} from '../../../core/shared/math-utils'
import { ElementPath } from '../../../core/shared/project-file-types'
import { getElementFromProjectContents } from '../../editor/store/editor-state'
import { stylePropPathMappingFn } from '../../inspector/common/property-path-hooks'
import { EdgePosition } from '../canvas-types'
import {
  AdjustCssLengthProperty,
  adjustCssLengthProperty,
} from '../commands/adjust-css-length-command'
import { setSnappingGuidelines } from '../commands/set-snapping-guidelines-command'
import { updateHighlightedViews } from '../commands/update-highlighted-views-command'
import { AbsoluteResizeControl } from '../controls/select-mode/absolute-resize-control'
import { AbsolutePin, hasAtLeastTwoPinsPerSide } from './absolute-resize-helpers'
import { CanvasStrategy } from './canvas-strategy-types'
import {
  getMultiselectBounds,
  resizeBoundingBox,
  runLegacyAbsoluteResizeSnapping,
} from './shared-absolute-move-strategy-helpers'

export const absoluteResizeBoundingBoxStrategy: CanvasStrategy = {
  id: 'ABSOLUTE_RESIZE_BOUNDING_BOX',
  name: 'Absolute Resize',
  isApplicable: (canvasState, interactionState, metadata) => {
    if (
      canvasState.selectedElements.length > 1 ||
      (canvasState.selectedElements.length >= 1 && interactionState?.interactionData.modifiers.alt)
    ) {
      return canvasState.selectedElements.every((element) => {
        const elementMetadata = MetadataUtils.findElementByElementPath(metadata, element)
        return (
          elementMetadata?.specialSizeMeasurements.position === 'absolute' &&
          hasAtLeastTwoPinsPerSide(elementMetadata.props)
        )
      })
    } else {
      return false
    }
  },
  controlsToRender: [
    { control: AbsoluteResizeControl, key: 'absolute-resize-control', show: 'always-visible' },
  ],
  fitness: (canvasState, interactionState, sessionState) => {
    return absoluteResizeBoundingBoxStrategy.isApplicable(
      canvasState,
      interactionState,
      sessionState.startingMetadata,
    ) &&
      interactionState.interactionData.type === 'DRAG' &&
      interactionState.activeControl.type === 'RESIZE_HANDLE'
      ? 1
      : 0
  },
  apply: (canvasState, interactionState, sessionState) => {
    if (
      interactionState.interactionData.type === 'DRAG' &&
      interactionState.interactionData.drag != null &&
      interactionState.activeControl.type === 'RESIZE_HANDLE'
    ) {
      const drag = interactionState.interactionData.drag
      const edgePosition = interactionState.activeControl.edgePosition

      const originalBoundingBox = getMultiselectBounds(
        sessionState.startingMetadata,
        canvasState.selectedElements,
      )
      if (originalBoundingBox != null) {
        const centerBased = interactionState.interactionData.modifiers.alt
        const newBoundingBox = resizeBoundingBox(
          originalBoundingBox,
          drag,
          edgePosition,
          centerBased,
        )
        const { snappedBoundingBox, guidelinesWithSnappingVector } = snapBoundingBox(
          canvasState.selectedElements,
          sessionState.startingMetadata,
          edgePosition,
          newBoundingBox,
          canvasState.scale,
          false,
          centerBased,
        )
        const commandsForSelectedElements = canvasState.selectedElements.flatMap(
          (selectedElement) => {
            const element = getElementFromProjectContents(
              selectedElement,
              canvasState.projectContents,
              canvasState.openFile,
            )
            const originalFrame = MetadataUtils.getFrameInCanvasCoords(
              selectedElement,
              sessionState.startingMetadata,
            )

            if (element == null || originalFrame == null) {
              return []
            }

            const newFrame = transformFrameUsingBoundingBox(
              snappedBoundingBox,
              originalBoundingBox,
              originalFrame,
            )
            const elementParentBounds =
              MetadataUtils.findElementByElementPath(sessionState.startingMetadata, selectedElement)
                ?.specialSizeMeasurements.immediateParentBounds ?? null

            return [
              ...createResizeCommandsFromFrame(
                element,
                selectedElement,
                newFrame,
                originalFrame,
                elementParentBounds,
              ),
              setSnappingGuidelines('transient', guidelinesWithSnappingVector),
            ]
          },
        )
        return [...commandsForSelectedElements, updateHighlightedViews('transient', [])]
      }
    }
    // Fallback for when the checks above are not satisfied.
    return []
  },
}

function createResizeCommandsFromFrame(
  element: JSXElement,
  selectedElement: ElementPath,
  newFrame: CanvasRectangle,
  originalFrame: CanvasRectangle,
  elementParentBounds: CanvasRectangle | null,
): AdjustCssLengthProperty[] {
  const pins: Array<AbsolutePin> = ['top', 'left', 'width', 'height', 'bottom', 'right']
  return mapDropNulls((pin) => {
    const horizontal = isHorizontalPoint(
      // TODO avoid using the loaded FramePoint enum
      framePointForPinnedProp(pin),
    )
    const value = getLayoutProperty(pin, right(element.props), ['style'])
    const rectangleDiff = rectangleDifference(originalFrame, newFrame)
    const delta = allPinsFromFrame(rectangleDiff)[pin]
    const roundedDelta = roundTo(delta, 0)
    const pinDirection = pin === 'right' || pin === 'bottom' ? -1 : 1
    if (isRight(value) && value.value != null && roundedDelta !== 0) {
      return adjustCssLengthProperty(
        'permanent',
        selectedElement,
        stylePropPathMappingFn(pin, ['style']),
        roundedDelta * pinDirection,
        horizontal ? elementParentBounds?.width : elementParentBounds?.height,
        true,
      )
    } else {
      return null
    }
  }, pins)
}

function allPinsFromFrame(frame: CanvasRectangle): { [key: string]: number } {
  return {
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
    right: frame.x + frame.width,
    bottom: frame.y + frame.height,
  }
}

function snapBoundingBox(
  selectedElements: Array<ElementPath>,
  jsxMetadata: ElementInstanceMetadataMap,
  edgePosition: EdgePosition,
  resizedBounds: CanvasRectangle,
  canvasScale: number,
  keepAspectRatio: boolean,
  centerBased: boolean,
) {
  const { snappedBoundingBox, guidelinesWithSnappingVector } = runLegacyAbsoluteResizeSnapping(
    selectedElements,
    jsxMetadata,
    edgePosition,
    resizedBounds,
    canvasScale,
    keepAspectRatio,
    centerBased,
  )

  return {
    snappedBoundingBox,
    guidelinesWithSnappingVector,
  }
}
