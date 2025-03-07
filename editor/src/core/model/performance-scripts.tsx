import React, { useRef } from 'react'
import * as ReactDOM from 'react-dom'
import CanvasActions from '../../components/canvas/canvas-actions'
import { DebugDispatch, DispatchPriority, EditorAction } from '../../components/editor/action-types'
import {
  clearSelection,
  deleteView,
  selectComponents,
  setFocusedElement,
  setProp_UNSAFE,
  switchEditorMode,
  unsetProperty,
  updateEditorMode,
} from '../../components/editor/actions/action-creators'
import { useEditorState, useRefEditorState } from '../../components/editor/store/store-hook'
import {
  canvasPoint,
  CanvasRectangle,
  CanvasVector,
  windowPoint,
  zeroPoint,
  zeroRectangle,
} from '../shared/math-utils'
import {
  CanvasContainerID,
  resizeDragState,
  updateResizeDragState,
} from '../../components/canvas/canvas-types'
import { MetadataUtils } from './element-metadata-utils'
import { getOriginalFrames } from '../../components/canvas/canvas-utils'
import * as EP from '../shared/element-path'
import * as PP from '../shared/property-path'
import { EditorModes } from '../../components/editor/editor-modes'
import {
  useCalculateHighlightedViews,
  useGetSelectableViewsForSelectMode,
} from '../../components/canvas/controls/select-mode/select-mode-hooks'
import { CanvasControlsContainerID } from '../../components/canvas/controls/new-canvas-controls'
import { forceNotNull } from '../shared/optional-utils'
import { ElementPathArrayKeepDeepEquality } from '../../utils/deep-equality-instances'
import { NavigatorContainerId } from '../../components/navigator/navigator'
import { emptyComments, jsxAttributeValue } from '../shared/element-template'
import { isFeatureEnabled, setFeatureEnabled } from '../../utils/feature-switches'
import { last } from '../shared/array-utils'
import { load } from '../../components/editor/actions/actions'
import { ProjectContentTreeRoot } from '../../components/assets'
import { PersistentModel } from '../../components/editor/store/editor-state'
import { CURRENT_PROJECT_VERSION } from '../../components/editor/actions/migrations/migrations'
import { BuiltInDependencies } from '../es-modules/package-manager/built-in-dependencies-list'
import { LargeProjectContents } from '../../test-cases/large-project'
import { VSCodeLoadingScreenID } from '../../components/code-editor/vscode-editor-loading-screen'

export function wait(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout)
  })
}

const NumberOfIterations = 100

function markStart(prefix: string, framesPassed: number): void {
  performance.mark(`${prefix}_start_${framesPassed}`)
}

function markEnd(prefix: string, framesPassed: number): void {
  performance.mark(`${prefix}_end_${framesPassed}`)
}

function measureStep(prefix: string, framesPassed: number): void {
  performance.measure(
    `${prefix}_step_${framesPassed}`,
    `${prefix}_start_${framesPassed}`,
    `${prefix}_end_${framesPassed}`,
  )
}

const CANVAS_POPULATE_WAIT_TIME_MS = 20 * 1000

let testProjectID: number = 999000

async function loadProjectInner(
  dispatch: DebugDispatch,
  builtInDependencies: BuiltInDependencies,
  projectContents: ProjectContentTreeRoot,
): Promise<boolean> {
  const persistentModel: PersistentModel = {
    forkedFromProjectId: null,
    projectVersion: CURRENT_PROJECT_VERSION,
    projectDescription: 'Performance Test Project',
    projectContents: projectContents,
    exportsInfo: [],
    lastUsedFont: null,
    hiddenInstances: [],
    codeEditorErrors: {
      buildErrors: {},
      lintErrors: {},
    },
    fileBrowser: {
      minimised: false,
    },
    dependencyList: {
      minimised: false,
    },
    projectSettings: {
      minimised: false,
    },
    navigator: {
      minimised: false,
    },
  }

  // Load the project itself.
  const newProjectID = testProjectID++
  await load(dispatch, persistentModel, 'Test', `${newProjectID}`, builtInDependencies, false)

  // Wait for the editor to stabilise, ensuring that the canvas can render for example.
  const startWaitingTime = Date.now()
  let editorReady: boolean = false
  let itemSelected: boolean = false
  let canvasPopulated: boolean = false
  let codeEditorPopulated: boolean = false
  let codeEditorLoaded: boolean = false
  while (startWaitingTime + CANVAS_POPULATE_WAIT_TIME_MS > Date.now() && !editorReady) {
    // Check canvas has been populated.
    if (!canvasPopulated) {
      const canvasContainerElement = document.getElementById(CanvasContainerID)
      if (canvasContainerElement != null) {
        if (canvasContainerElement.children.length > 0) {
          canvasPopulated = true
        }
      }
    }

    // Select _something_ to trigger the code editor.
    //if (codeEditorLoaded) {
    const itemLabelContainer = document.querySelector(`div[class~="item-label-container"]`)
    if (itemLabelContainer != null) {
      if (itemLabelContainer instanceof HTMLElement) {
        itemSelected = true
        itemLabelContainer.click()
      }
    }
    //}

    // Wait for the code to appear in the code editor.
    if (!codeEditorPopulated) {
      const loadingScreenElement = document.querySelector(`div#${VSCodeLoadingScreenID}`)
      const vscodeEditorElement = document.querySelector(`iframe#vscode-editor`)
      if (vscodeEditorElement != null && loadingScreenElement == null) {
        // Drill down inside the outer iframe.
        const vscodeOuterElement = (vscodeEditorElement as any).contentWindow?.document.body.querySelector(
          `iframe#vscode-outer`,
        )
        if (vscodeOuterElement != null) {
          codeEditorLoaded = true
          const firstViewLine = (vscodeOuterElement as any).contentWindow?.document.body.querySelector(
            `div.view-line`,
          )
          if (firstViewLine != null) {
            codeEditorPopulated = true
          }
        }
      }
    }

    // Appears the code editor can't be relied on to load enough of the time for
    // this check to not break everything.
    editorReady = canvasPopulated // && codeEditorPopulated

    if (!editorReady) {
      await wait(500)
    }
  }

  // Give the editor a little bit of an extra window of time just in case.
  if (editorReady) {
    await wait(2000)
  }
  return editorReady
}

const LOAD_PROJECT_MAX_ATTEMPTS = 3

async function loadProject(
  dispatch: DebugDispatch,
  builtInDependencies: BuiltInDependencies,
  projectContents: ProjectContentTreeRoot,
): Promise<boolean> {
  for (let attempt = 1; attempt <= LOAD_PROJECT_MAX_ATTEMPTS; attempt++) {
    const result = await loadProjectInner(dispatch, builtInDependencies, projectContents)
    if (result) {
      return true
    }
  }
  return false
}

export function useTriggerScrollPerformanceTest(): () => void {
  const dispatch = useEditorState(
    (store) => store.dispatch as DebugDispatch,
    'useTriggerScrollPerformanceTest dispatch',
  )
  const builtInDependencies = useEditorState(
    (store) => store.builtInDependencies,
    'useTriggerScrollPerformanceTest builtInDependencies',
  )
  const allPaths = useRefEditorState((store) => store.derived.navigatorTargets)
  const trigger = React.useCallback(async () => {
    const editorReady = await loadProject(dispatch, builtInDependencies, LargeProjectContents)
    if (!editorReady) {
      console.info('SCROLL_TEST_ERROR')
      return
    }

    if (allPaths.current.length === 0) {
      console.info('SCROLL_TEST_ERROR')
      return
    }

    const targetPath = [...allPaths.current].sort(
      (a, b) => EP.toString(b).length - EP.toString(a).length,
    )[0]

    await dispatch([selectComponents([targetPath!], false)]).entireUpdateFinished

    let framesPassed = 0
    async function step() {
      markStart('scroll', framesPassed)
      await dispatch([CanvasActions.scrollCanvas(canvasPoint({ x: -5, y: -1 }))])
        .entireUpdateFinished
      markEnd('scroll', framesPassed)
      measureStep('scroll', framesPassed)
      if (framesPassed < NumberOfIterations) {
        framesPassed++
        requestAnimationFrame(step)
      } else {
        console.info('SCROLL_TEST_FINISHED')
      }
    }
    requestAnimationFrame(step)
  }, [dispatch, allPaths, builtInDependencies])
  return trigger
}

export function useTriggerResizePerformanceTest(): () => void {
  const dispatch = useEditorState(
    (store) => store.dispatch as DebugDispatch,
    'useTriggerResizePerformanceTest dispatch',
  )
  const metadata = useRefEditorState((store) => store.editor.jsxMetadata)
  const selectedViews = useRefEditorState((store) => store.editor.selectedViews)
  const builtInDependencies = useEditorState(
    (store) => store.builtInDependencies,
    'useTriggerResizePerformanceTest builtInDependencies',
  )
  const allPaths = useRefEditorState(
    React.useCallback((store) => store.derived.navigatorTargets, []),
  )
  const trigger = React.useCallback(async () => {
    const editorReady = await loadProject(dispatch, builtInDependencies, LargeProjectContents)
    if (!editorReady) {
      console.info('RESIZE_TEST_ERROR')
      return
    }
    const targetPath = [...allPaths.current].sort(
      (a, b) => EP.toString(b).length - EP.toString(a).length,
    )[0]
    await dispatch([
      switchEditorMode(EditorModes.selectMode()),
      selectComponents([targetPath], false),
    ]).entireUpdateFinished

    const target = selectedViews.current[0]
    const targetFrame = MetadataUtils.findElementByElementPath(metadata.current, target)
      ?.globalFrame
    const targetStartPoint =
      targetFrame != null
        ? ({
            x: targetFrame.x + targetFrame.width,
            y: targetFrame.y + targetFrame.height,
          } as CanvasVector)
        : (zeroPoint as CanvasVector)
    const originalFrames = getOriginalFrames(selectedViews.current, metadata.current)

    let framesPassed = 0
    async function step() {
      markStart('resize', framesPassed)
      const dragState = updateResizeDragState(
        resizeDragState(
          targetFrame ?? (zeroRectangle as CanvasRectangle),
          originalFrames,
          { x: 1, y: 1 },
          { x: 1, y: 1 },
          metadata.current,
          [target],
          false,
          [],
        ),
        targetStartPoint,
        { x: framesPassed % 100, y: framesPassed % 100 } as CanvasVector,
        'width',
        true,
        false,
        false,
      )
      await dispatch([CanvasActions.createDragState(dragState)]).entireUpdateFinished
      markEnd('resize', framesPassed)
      measureStep('resize', framesPassed)
      if (framesPassed < NumberOfIterations) {
        framesPassed++
        requestAnimationFrame(step)
      } else {
        await dispatch([CanvasActions.clearDragState(false)]).entireUpdateFinished
        console.info('RESIZE_TEST_FINISHED')
      }
    }
    requestAnimationFrame(step)
  }, [dispatch, metadata, selectedViews, allPaths, builtInDependencies])
  return trigger
}

function useTriggerHighlightPerformanceTest(key: 'regular' | 'all-elements'): () => void {
  const allPaths = useRefEditorState((store) => store.derived.navigatorTargets)
  const getHighlightableViews = useGetSelectableViewsForSelectMode()
  const calculateHighlightedViews = useCalculateHighlightedViews(true, getHighlightableViews)
  const dispatch = useEditorState(
    (store) => store.dispatch as DebugDispatch,
    'useTriggerHighlightPerformanceTest dispatch',
  )
  const builtInDependencies = useEditorState(
    (store) => store.builtInDependencies,
    'useTriggerHighlightPerformanceTest builtInDependencies',
  )
  const trigger = React.useCallback(async () => {
    const allCapsKey = key.toLocaleUpperCase()
    const editorReady = await loadProject(dispatch, builtInDependencies, LargeProjectContents)
    if (!editorReady) {
      console.info(`HIGHLIGHT_${allCapsKey}_TEST_ERROR`)
      return
    }
    if (allPaths.current.length === 0) {
      console.info(`HIGHLIGHT_${allCapsKey}_TEST_ERROR_NO_PATHS`)
      return
    }

    const targetPath = allPaths.current[0]

    const htmlElement = document.querySelector(`*[data-path^="${EP.toString(targetPath)}"]`)
    if (htmlElement == null) {
      console.info(`HIGHLIGHT_${allCapsKey}_TEST_ERROR_NO_ELEMENT`)
      return
    }

    const elementBounds = htmlElement.getBoundingClientRect()

    let framesPassed = 0
    async function step() {
      markStart(`highlight_${key}`, framesPassed)

      calculateHighlightedViews(
        windowPoint({ x: elementBounds.left + 10, y: elementBounds.top + 10 }),
        key === 'all-elements',
      )

      // Clear the highlight before the next run
      calculateHighlightedViews(
        windowPoint({ x: elementBounds.left - 100, y: elementBounds.top - 100 }),
        key === 'all-elements',
      )
      markEnd(`highlight_${key}`, framesPassed)
      measureStep(`highlight_${key}`, framesPassed)

      if (framesPassed < NumberOfIterations) {
        framesPassed++
        requestAnimationFrame(step)
      } else {
        console.info(`HIGHLIGHT_${allCapsKey}_TEST_FINISHED`)
      }
    }
    requestAnimationFrame(step)
  }, [allPaths, calculateHighlightedViews, key, builtInDependencies, dispatch])

  return trigger
}

export const useTriggerRegularHighlightPerformanceTest = () =>
  useTriggerHighlightPerformanceTest('regular')

export const useTriggerAllElementsHighlightPerformanceTest = () =>
  useTriggerHighlightPerformanceTest('all-elements')

export function useTriggerSelectionPerformanceTest(): () => void {
  const dispatch = useEditorState(
    (store) => store.dispatch as DebugDispatch,
    'useTriggerSelectionPerformanceTest dispatch',
  )
  const allPaths = useRefEditorState((store) => store.derived.navigatorTargets)
  const selectedViews = useRefEditorState((store) => store.editor.selectedViews)
  const builtInDependencies = useEditorState(
    (store) => store.builtInDependencies,
    'useTriggerSelectionPerformanceTest builtInDependencies',
  )
  const trigger = React.useCallback(async () => {
    const editorReady = await loadProject(dispatch, builtInDependencies, LargeProjectContents)
    if (!editorReady) {
      console.info('SELECT_TEST_ERROR')
      return
    }
    const targetPath = [...allPaths.current].sort(
      (a, b) => EP.toString(b).length - EP.toString(a).length,
    )[0]
    // Determine where the events should be fired.
    const controlsContainerElement = forceNotNull(
      'Container controls element should exist.',
      document.getElementById(CanvasControlsContainerID),
    )
    const canvasContainerElement = forceNotNull(
      'Canvas container element should exist.',
      document.getElementById(CanvasContainerID),
    )
    const canvasContainerBounds = canvasContainerElement.getBoundingClientRect()
    const navigatorElement = forceNotNull(
      'Navigator element should exist.',
      document.getElementById(NavigatorContainerId),
    )
    const navigatorBounds = navigatorElement.getBoundingClientRect()

    const targetElement = forceNotNull(
      'Target element should exist.',
      document.querySelector(`*[data-path^="${EP.toString(targetPath)}"]`),
    )
    const originalTargetBounds = targetElement.getBoundingClientRect()
    const leftToTarget =
      canvasContainerBounds.left + navigatorBounds.width - originalTargetBounds.left + 100
    const topToTarget = canvasContainerBounds.top - originalTargetBounds.top + 100
    await dispatch(
      [CanvasActions.positionCanvas(canvasPoint({ x: leftToTarget, y: topToTarget }))],
      'everyone',
    ).entireUpdateFinished
    const targetBounds = targetElement.getBoundingClientRect()
    if (allPaths.current.length === 0) {
      console.info('SELECT_TEST_ERROR')
      return
    }

    let framesPassed = 0
    async function step() {
      markStart('select', framesPassed)
      controlsContainerElement.dispatchEvent(
        new MouseEvent('mousedown', {
          detail: 1,
          bubbles: true,
          cancelable: true,
          metaKey: true,
          clientX: targetBounds.left + 5,
          clientY: targetBounds.top + 5,
          buttons: 1,
        }),
      )
      function isTargetSelected(): boolean {
        return ElementPathArrayKeepDeepEquality([targetPath], selectedViews.current).areEqual
      }
      const startingTime = Date.now()
      while (!isTargetSelected() && Date.now() < startingTime + 3000) {
        await wait(5)
      }
      if (!isTargetSelected()) {
        throw new Error(`Element never ended up being selected.`)
      }
      controlsContainerElement.dispatchEvent(
        new MouseEvent('pointerup', {
          detail: 1,
          bubbles: true,
          cancelable: true,
          metaKey: true,
          clientX: targetBounds.left + 5,
          clientY: targetBounds.top + 5,
          buttons: 1,
        }),
      )
      controlsContainerElement.dispatchEvent(
        new MouseEvent('mouseup', {
          detail: 1,
          bubbles: true,
          cancelable: true,
          metaKey: true,
          clientX: targetBounds.left + 5,
          clientY: targetBounds.top + 5,
          buttons: 1,
        }),
      )
      markEnd('select', framesPassed)
      measureStep('select', framesPassed)

      markStart('select_deselect', framesPassed)
      await dispatch([clearSelection()]).entireUpdateFinished
      markEnd('select_deselect', framesPassed)
      measureStep('select_deselect', framesPassed)

      if (framesPassed < NumberOfIterations) {
        framesPassed++
        requestAnimationFrame(step)
      } else {
        console.info('SELECT_TEST_FINISHED')
      }
    }
    requestAnimationFrame(step)
  }, [dispatch, allPaths, selectedViews, builtInDependencies])
  return trigger
}

export function useTriggerAbsoluteMovePerformanceTest(): () => void {
  const dispatch = useEditorState(
    React.useCallback((store) => store.dispatch as DebugDispatch, []),
    'useTriggerAbsoluteMovePerformanceTest dispatch',
  )
  const allPaths = useRefEditorState(
    React.useCallback((store) => store.derived.navigatorTargets, []),
  )
  const metadata = useRefEditorState(React.useCallback((store) => store.editor.jsxMetadata, []))
  const selectedViews = useRefEditorState(
    React.useCallback((store) => store.editor.selectedViews, []),
  )
  const builtInDependencies = useEditorState(
    (store) => store.builtInDependencies,
    'useTriggerAbsoluteMovePerformanceTest builtInDependencies',
  )
  const trigger = React.useCallback(async () => {
    const editorReady = await loadProject(dispatch, builtInDependencies, LargeProjectContents)
    if (!editorReady) {
      console.info('ABSOLUTE_MOVE_TEST_ERROR')
      return
    }
    const initialTargetPath = [...allPaths.current].sort(
      (a, b) => EP.toString(b).length - EP.toString(a).length,
    )[0]
    // This is very particularly tied to the test project in LargeProjectContents, we _really_ need
    // to pick the right element because our changes can cause other elements to end up on top of the
    // target we want.
    const parentParentPath = EP.parentPath(EP.parentPath(initialTargetPath))
    const grandChildrenPaths = allPaths.current.filter((path) => {
      return EP.pathsEqual(parentParentPath, EP.parentPath(EP.parentPath(path)))
    })
    if (grandChildrenPaths.length === 0) {
      console.info('ABSOLUTE_MOVE_TEST_ERROR')
      return
    }
    const targetPath = forceNotNull('Invalid array.', last(grandChildrenPaths))

    // Switch Canvas Strategies on.
    const strategiesCurrentlyEnabled = isFeatureEnabled('Canvas Strategies')
    setFeatureEnabled('Canvas Strategies', true)
    // Delete the other children that just get in the way.
    const parentPath = EP.parentPath(targetPath)
    const siblingPaths = allPaths.current.filter(
      (path) => EP.isChildOf(path, parentPath) && !EP.pathsEqual(path, targetPath),
    )
    await dispatch(
      siblingPaths.map((path) => deleteView(path)),
      'everyone',
    ).entireUpdateFinished
    // Focus the target so that we can edit the child div inside it.
    await dispatch([setFocusedElement(targetPath)], 'everyone').entireUpdateFinished
    const childTargetPath = allPaths.current.find((path) => EP.isChildOf(path, targetPath))
    if (childTargetPath == null) {
      console.info('ABSOLUTE_MOVE_TEST_ERROR')
      return
    }
    const childMetadata = MetadataUtils.findElementByElementPath(metadata.current, childTargetPath)
    if (
      childMetadata == null ||
      childMetadata.globalFrame == null ||
      childMetadata.specialSizeMeasurements.coordinateSystemBounds == null
    ) {
      console.info('ABSOLUTE_MOVE_TEST_ERROR')
      return
    }
    const childStyleValue = {
      position: 'absolute',
      left:
        childMetadata.globalFrame.x -
        childMetadata.specialSizeMeasurements.coordinateSystemBounds.x,
      top:
        childMetadata.globalFrame.y -
        childMetadata.specialSizeMeasurements.coordinateSystemBounds.y,
      width: childMetadata.globalFrame.width,
      height: childMetadata.globalFrame.height,
    }

    // Determine where the events should be fired.
    const controlsContainerElement = forceNotNull(
      'Container controls element should exist.',
      document.getElementById(CanvasControlsContainerID),
    )
    const canvasContainerElement = forceNotNull(
      'Canvas container element should exist.',
      document.getElementById(CanvasContainerID),
    )
    const canvasContainerBounds = canvasContainerElement.getBoundingClientRect()
    const navigatorElement = forceNotNull(
      'Navigator element should exist.',
      document.getElementById(NavigatorContainerId),
    )
    const navigatorBounds = navigatorElement.getBoundingClientRect()

    const targetElement = forceNotNull(
      'Target element should exist.',
      document.querySelector(`*[data-path^="${EP.toString(childTargetPath)}"]`),
    )
    const originalTargetBounds = targetElement.getBoundingClientRect()
    const leftToTarget =
      canvasContainerBounds.left + navigatorBounds.width - originalTargetBounds.left + 100
    const topToTarget = canvasContainerBounds.top - originalTargetBounds.top + 100
    await dispatch(
      [
        updateEditorMode(EditorModes.selectMode()),
        CanvasActions.positionCanvas(canvasPoint({ x: leftToTarget, y: topToTarget })),
      ],
      'everyone',
    ).entireUpdateFinished
    const targetBounds = targetElement.getBoundingClientRect()

    let framesPassed = 0
    async function step() {
      // Make the div inside the target absolute positioned and ensure it is selected.
      await dispatch(
        [
          selectComponents([childTargetPath!], false),
          setProp_UNSAFE(
            childTargetPath!,
            PP.create(['style']),
            jsxAttributeValue(childStyleValue, emptyComments),
          ),
        ],
        'everyone',
      ).entireUpdateFinished
      markStart('absolute_move_interaction', framesPassed)

      // Move it down and to the right.
      controlsContainerElement.dispatchEvent(
        new MouseEvent('mousedown', {
          detail: 1,
          bubbles: true,
          cancelable: true,
          metaKey: false,
          clientX: targetBounds.left + 20,
          clientY: targetBounds.top + 20,
          buttons: 1,
        }),
      )
      await wait(0)

      // Mouse move and performance marks for that.
      markStart('absolute_move_move', framesPassed)
      for (let moveCount = 1; moveCount <= 1; moveCount++) {
        controlsContainerElement.dispatchEvent(
          new MouseEvent('mousemove', {
            detail: 1,
            bubbles: true,
            cancelable: true,
            metaKey: false,
            clientX: targetBounds.left + (20 + moveCount * 3),
            clientY: targetBounds.top + (20 + moveCount * 4),
            buttons: 1,
          }),
        )
        await wait(0)
      }
      markEnd('absolute_move_move', framesPassed)
      measureStep('absolute_move_move', framesPassed)

      controlsContainerElement.dispatchEvent(
        new MouseEvent('mouseup', {
          detail: 1,
          bubbles: true,
          cancelable: true,
          metaKey: false,
          clientX: targetBounds.left + 50,
          clientY: targetBounds.top + 60,
          buttons: 1,
        }),
      )
      await wait(0)
      markEnd('absolute_move_interaction', framesPassed)
      measureStep('absolute_move_interaction', framesPassed)

      if (framesPassed < NumberOfIterations) {
        framesPassed++
        requestAnimationFrame(step)
      } else {
        // Potentially turn off Canvas Strategies.
        setFeatureEnabled('Canvas Strategies', strategiesCurrentlyEnabled)
        // Reset the position.
        await dispatch([unsetProperty(childTargetPath!, PP.create(['style']))], 'everyone')
          .entireUpdateFinished
        // Unfocus the target.
        await dispatch([setFocusedElement(null)], 'everyone').entireUpdateFinished

        console.info('ABSOLUTE_MOVE_TEST_FINISHED')
      }
    }
    requestAnimationFrame(step)
  }, [dispatch, allPaths, metadata, builtInDependencies])
  return trigger
}

export function useTriggerBaselinePerformanceTest(): () => void {
  const dispatch = useEditorState(
    (store) => store.dispatch as DebugDispatch,
    'useTriggerSelectionPerformanceTest dispatch',
  )
  const builtInDependencies = useEditorState(
    (store) => store.builtInDependencies,
    'useTriggerScrollPerformanceTest builtInDependencies',
  )
  const trigger = React.useCallback(async () => {
    const editorReady = await loadProject(dispatch, builtInDependencies, LargeProjectContents)
    if (!editorReady) {
      console.info('BASELINE_TEST_ERROR')
      return
    }

    let framesPassed = 0
    async function step() {
      markStart('baseline', framesPassed)
      for (let i = 0; i < 3000; i++) {
        await dispatch([]).entireUpdateFinished
      }
      markEnd('baseline', framesPassed)
      measureStep('baseline', framesPassed)

      if (framesPassed < NumberOfIterations) {
        framesPassed++
        requestAnimationFrame(step)
      } else {
        requestAnimationFrame(() => console.info('BASELINE_TEST_FINISHED'))
      }
    }
    requestAnimationFrame(step)
  }, [dispatch, builtInDependencies])

  return trigger
}
