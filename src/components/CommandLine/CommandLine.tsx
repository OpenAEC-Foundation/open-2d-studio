import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useAppStore, generateId } from '../../state/appStore';
import { parseCoordinateInput } from '../../utils/coordinateParser';
import type { LineShape, RectangleShape, CircleShape } from '../../types/geometry';
import {
  resolveCommandName,
  createInitialCommandState,
  startCommand,
  processCommandInput,
  getCommandPreview,
  type CommandState,
  type CommandInput,
  type CommandResult,
} from '../../commands';

type DrawingOption = 'Undo' | 'Close' | 'Cancel';

export const CommandLine = memo(function CommandLine() {
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [messages, setMessages] = useState<string[]>(['Ready']);
  const [commandState, setCommandState] = useState<CommandState>(createInitialCommandState());

  // Subscribe only to render-affecting state
  const currentCommand = useAppStore(s => s.currentCommand);
  const setCurrentCommand = useAppStore(s => s.setCurrentCommand);
  const activeTool = useAppStore(s => s.activeTool);
  const drawingPointsLength = useAppStore(s => s.drawingPoints.length);
  const isDrawing = useAppStore(s => s.isDrawing);
  const pendingCommand = useAppStore(s => s.pendingCommand);
  const pendingCommandPoint = useAppStore(s => s.pendingCommandPoint);
  const pendingCommandSelection = useAppStore(s => s.pendingCommandSelection);
  const pendingCommandCancel = useAppStore(s => s.pendingCommandCancel);
  const mousePosition = useAppStore(s => s.mousePosition);
  const commandHistory = useAppStore(s => s.commandHistory);

  // Actions (stable references from store)
  const addDrawingPoint = useAppStore(s => s.addDrawingPoint);
  const undoDrawingPoint = useAppStore(s => s.undoDrawingPoint);
  const clearDrawingPoints = useAppStore(s => s.clearDrawingPoints);
  const setDrawingPreview = useAppStore(s => s.setDrawingPreview);
  const addShape = useAppStore(s => s.addShape);
  const updateShape = useAppStore(s => s.updateShape);
  const deleteShape = useAppStore(s => s.deleteShape);
  const deselectAll = useAppStore(s => s.deselectAll);
  const setActiveTool = useAppStore(s => s.setActiveTool);
  const setPendingCommand = useAppStore(s => s.setPendingCommand);
  const setPendingCommandPoint = useAppStore(s => s.setPendingCommandPoint);
  const setPendingCommandSelection = useAppStore(s => s.setPendingCommandSelection);
  const setHasActiveModifyCommand = useAppStore(s => s.setHasActiveModifyCommand);
  const setCommandIsSelecting = useAppStore(s => s.setCommandIsSelecting);
  const setCommandPreviewShapes = useAppStore(s => s.setCommandPreviewShapes);
  const setPrintDialogOpen = useAppStore(s => s.setPrintDialogOpen);
  const clearCommandCancelRequest = useAppStore(s => s.clearCommandCancelRequest);
  const setActiveCommandName = useAppStore(s => s.setActiveCommandName);
  const setCommandBasePoint = useAppStore(s => s.setCommandBasePoint);

  // Check if we have an active modify command
  const hasActiveCommand = commandState.activeCommand !== null;

  // Get current prompt based on tool, drawing state, or command state
  const getPrompt = useCallback((): string => {
    if (hasActiveCommand) {
      return commandState.prompt;
    }

    switch (activeTool) {
      case 'line':
        if (drawingPointsLength === 0) {
          return 'LINE Specify first point:';
        } else if (drawingPointsLength === 1) {
          return 'Specify next point, distance, or [Undo]:';
        } else {
          return 'Specify next point, distance, or [Close/Undo]:';
        }

      case 'polyline':
        if (drawingPointsLength === 0) {
          return 'POLYLINE Specify first point:';
        } else if (drawingPointsLength === 1) {
          return 'Specify next point, distance, or [Undo]:';
        } else {
          return 'Specify next point, distance, or [Close/Undo]:';
        }

      case 'spline':
        if (drawingPointsLength === 0) {
          return 'SPLINE Specify first point:';
        } else if (drawingPointsLength === 1) {
          return 'Specify next point:';
        } else {
          return 'Specify next point or [Close/Undo] (right-click to finish):';
        }

      case 'rectangle':
        if (drawingPointsLength === 0) {
          return 'RECTANG Specify first corner point:';
        } else {
          return 'Specify other corner point:';
        }

      case 'circle':
        if (drawingPointsLength === 0) {
          return 'CIRCLE Specify center point:';
        } else {
          return 'Specify radius or [Diameter]:';
        }

      case 'select':
        return 'Select objects:';

      case 'pan':
        return 'Press Esc or Enter to exit, or click and drag to pan.';

      default:
        return 'Command:';
    }
  }, [activeTool, drawingPointsLength, hasActiveCommand, commandState.prompt]);

  // Get available options based on current state
  const getOptions = useCallback((): string[] => {
    // If there's an active command, use its options
    if (hasActiveCommand) {
      return commandState.options || [];
    }

    if (!isDrawing) return [];

    const options: DrawingOption[] = ['Cancel'];

    if (drawingPointsLength > 0) {
      options.unshift('Undo');
    }

    if ((activeTool === 'line' || activeTool === 'polyline') && drawingPointsLength >= 2) {
      options.unshift('Close');
    }

    return options;
  }, [isDrawing, drawingPointsLength, activeTool, hasActiveCommand, commandState.options]);

  // Add message to history
  const addMessage = useCallback((msg: string) => {
    setMessages((prev) => [...prev.slice(-50), msg]); // Keep last 50 messages
  }, []);

  // Apply command result
  const applyCommandResult = useCallback((result: CommandResult) => {
    if (result.message) {
      addMessage(result.message);
    }

    if (result.shapesToAdd) {
      result.shapesToAdd.forEach((shape) => addShape(shape));
    }

    if (result.shapesToUpdate) {
      result.shapesToUpdate.forEach(({ id, updates }) => updateShape(id, updates));
    }

    if (result.shapesToDelete) {
      result.shapesToDelete.forEach((id) => deleteShape(id));
    }

    if (result.newState) {
      setCommandState((prev) => ({ ...prev, ...result.newState }));

      if (result.newState.phase === 'idle' && result.newState.activeCommand === null) {
        deselectAll();
      }
    }

    if (result.openPrintDialog) {
      setPrintDialogOpen(true);
    }

    if (!result.continue && result.newState?.activeCommand === null) {
      setCommandState(createInitialCommandState());
    }
  }, [addMessage, addShape, updateShape, deleteShape, deselectAll, setPrintDialogOpen]);

  // Create shapes - read layer/drawing/style from store at call time
  const createLine = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const s = useAppStore.getState();
      const lineShape: LineShape = {
        id: generateId(),
        type: 'line',
        layerId: s.activeLayerId,
        drawingId: s.activeDrawingId,
        style: { ...s.currentStyle },
        visible: true,
        locked: false,
        start,
        end,
      };
      addShape(lineShape);
    },
    [addShape]
  );

  const createRectangle = useCallback(
    (start: { x: number; y: number }, end: { x: number; y: number }) => {
      const s = useAppStore.getState();
      const width = end.x - start.x;
      const height = end.y - start.y;
      const rectShape: RectangleShape = {
        id: generateId(),
        type: 'rectangle',
        layerId: s.activeLayerId,
        drawingId: s.activeDrawingId,
        style: { ...s.currentStyle },
        visible: true,
        locked: false,
        topLeft: {
          x: width > 0 ? start.x : end.x,
          y: height > 0 ? start.y : end.y,
        },
        width: Math.abs(width),
        height: Math.abs(height),
        rotation: 0,
      };
      addShape(rectShape);
    },
    [addShape]
  );

  const createCircle = useCallback(
    (center: { x: number; y: number }, radius: number) => {
      const s = useAppStore.getState();
      const circleShape: CircleShape = {
        id: generateId(),
        type: 'circle',
        layerId: s.activeLayerId,
        drawingId: s.activeDrawingId,
        style: { ...s.currentStyle },
        visible: true,
        locked: false,
        center,
        radius,
      };
      addShape(circleShape);
    },
    [addShape]
  );

  // Handle option click (for drawing tools)
  const handleDrawingOption = useCallback(
    (option: DrawingOption) => {
      switch (option) {
        case 'Undo':
          undoDrawingPoint();
          addMessage('*Undo*');
          break;

        case 'Close': {
          const s = useAppStore.getState();
          if (s.activeTool === 'line' && s.drawingPoints.length >= 2) {
            const firstPoint = s.drawingPoints[0];
            const lastPoint = s.drawingPoints[s.drawingPoints.length - 1];
            createLine(lastPoint, firstPoint);
            addMessage('Line closed');
            clearDrawingPoints();
            setDrawingPreview(null);
          }
          break;
        }

        case 'Cancel':
          clearDrawingPoints();
          setDrawingPreview(null);
          addMessage('*Cancel*');
          break;
      }
    },
    [undoDrawingPoint, clearDrawingPoints, setDrawingPreview, createLine, addMessage]
  );

  // Handle option click (for commands)
  const handleCommandOption = useCallback(
    (option: string) => {
      const input: CommandInput = { type: 'option', option };
      const result = processCommandInput(commandState, input, useAppStore.getState().shapes);
      applyCommandResult(result);
    },
    [commandState, applyCommandResult]
  );

  // Handle option click (generic)
  const handleOption = useCallback(
    (option: string) => {
      if (hasActiveCommand) {
        handleCommandOption(option);
      } else {
        handleDrawingOption(option as DrawingOption);
      }
    },
    [hasActiveCommand, handleCommandOption, handleDrawingOption]
  );

  // Handle command input
  const handleCommand = useCallback(
    (input: string) => {
      const trimmed = input.trim();
      const lowerInput = trimmed.toLowerCase();
      const s = useAppStore.getState();

      // If there's an active command, process input through command system
      if (hasActiveCommand) {
        let cmdInput: CommandInput;

        const matchedOption = commandState.options?.find(
          (o) => o.toLowerCase() === lowerInput || o.toLowerCase().startsWith(lowerInput)
        );

        if (matchedOption) {
          cmdInput = { type: 'option', option: matchedOption };
        } else if (trimmed === '') {
          cmdInput = { type: 'enter' };
        } else {
          const numValue = parseFloat(trimmed);
          if (!isNaN(numValue) && trimmed.match(/^-?[\d.]+$/)) {
            cmdInput = { type: 'value', value: numValue };
          } else {
            const lastPoint = commandState.basePoint || { x: 0, y: 0 };
            const parsed = parseCoordinateInput(trimmed, lastPoint);
            if (parsed) {
              cmdInput = { type: 'point', point: parsed.point };
            } else {
              cmdInput = { type: 'text', text: trimmed };
            }
          }
        }

        const result = processCommandInput(commandState, cmdInput, s.shapes);
        applyCommandResult(result);
        return;
      }

      // Check for tool/command shortcuts
      const commandName = resolveCommandName(trimmed);
      if (commandName) {
        const drawingTools = ['LINE', 'RECTANGLE', 'CIRCLE', 'ARC', 'POLYLINE', 'SPLINE', 'ELLIPSE'];
        if (drawingTools.includes(commandName)) {
          const toolMap: Record<string, 'line' | 'rectangle' | 'circle' | 'arc' | 'polyline' | 'spline' | 'ellipse'> = {
            LINE: 'line',
            RECTANGLE: 'rectangle',
            CIRCLE: 'circle',
            ARC: 'arc',
            POLYLINE: 'polyline',
            SPLINE: 'spline',
            ELLIPSE: 'ellipse',
          };
          setActiveTool(toolMap[commandName] || 'select');
          addMessage(commandName);
          return;
        }

        const newState = startCommand(commandName, createInitialCommandState(), s.selectedShapeIds);
        setCommandState(newState);
        addMessage(commandName);
        return;
      }

      // Legacy tool commands
      if (!s.isDrawing) {
        switch (lowerInput) {
          case 'l':
          case 'line':
            setActiveTool('line');
            addMessage('LINE');
            return;
          case 'rec':
          case 'rectang':
          case 'rectangle':
            setActiveTool('rectangle');
            addMessage('RECTANG');
            return;
          case 'c':
          case 'circle':
            setActiveTool('circle');
            addMessage('CIRCLE');
            return;
          case 'p':
          case 'pan':
            setActiveTool('pan');
            addMessage('PAN');
            return;
        }
      }

      // Check for drawing options
      switch (lowerInput) {
        case 'u':
        case 'undo':
          if (s.isDrawing && s.drawingPoints.length > 0) {
            handleDrawingOption('Undo');
            return;
          }
          break;

        case 'close':
          if ((s.activeTool === 'line' || s.activeTool === 'polyline') && s.drawingPoints.length >= 2) {
            handleDrawingOption('Close');
            return;
          }
          break;

        case '':
          if (s.isDrawing) {
            clearDrawingPoints();
            setDrawingPreview(null);
            addMessage('');
            return;
          }
          break;
      }

      // Try to parse as coordinates for drawing tools
      if (s.activeTool === 'line' || s.activeTool === 'polyline' || s.activeTool === 'rectangle' || s.activeTool === 'circle') {
        const lastPoint = s.drawingPoints.length > 0 ? s.drawingPoints[s.drawingPoints.length - 1] : null;
        const parsed = parseCoordinateInput(trimmed, lastPoint);

        if (parsed) {
          let point = parsed.point;

          if (parsed.isDirectDistance && lastPoint) {
            const distance = parsed.point.x;

            if (s.directDistanceAngle !== null) {
              point = {
                x: lastPoint.x + distance * Math.cos(s.directDistanceAngle),
                y: lastPoint.y + distance * Math.sin(s.directDistanceAngle),
              };
            } else {
              const worldX = (s.mousePosition.x - s.viewport.offsetX) / s.viewport.zoom;
              const worldY = (s.mousePosition.y - s.viewport.offsetY) / s.viewport.zoom;
              const dx = worldX - lastPoint.x;
              const dy = worldY - lastPoint.y;
              const mouseAngle = Math.atan2(dy, dx);
              point = {
                x: lastPoint.x + distance * Math.cos(mouseAngle),
                y: lastPoint.y + distance * Math.sin(mouseAngle),
              };
            }
          }

          switch (s.activeTool) {
            case 'line':
            case 'polyline':
              if (s.drawingPoints.length === 0) {
                if (parsed.isDirectDistance) {
                  addMessage('Cannot use direct distance for first point. Enter coordinates.');
                  return;
                }
                addDrawingPoint(point);
                addMessage(`First point: ${point.x.toFixed(2)}, ${point.y.toFixed(2)}`);
              } else {
                const prevPoint = s.drawingPoints[s.drawingPoints.length - 1];
                if (s.activeTool === 'line') {
                  createLine(prevPoint, point);
                }
                addDrawingPoint(point);
                addMessage(`${s.activeTool === 'line' ? 'Line' : 'Polyline'} to: ${point.x.toFixed(2)}, ${point.y.toFixed(2)}`);
              }
              break;

            case 'rectangle':
              if (s.drawingPoints.length === 0) {
                addDrawingPoint(point);
                addMessage(`First corner: ${point.x.toFixed(2)}, ${point.y.toFixed(2)}`);
              } else {
                const startPoint = s.drawingPoints[0];
                createRectangle(startPoint, point);
                clearDrawingPoints();
                setDrawingPreview(null);
                addMessage(`Rectangle created`);
              }
              break;

            case 'circle':
              if (s.drawingPoints.length === 0) {
                addDrawingPoint(point);
                addMessage(`Center: ${point.x.toFixed(2)}, ${point.y.toFixed(2)}`);
              } else {
                const center = s.drawingPoints[0];
                let radius: number;

                const radiusValue = parseFloat(trimmed);
                if (!isNaN(radiusValue) && trimmed.match(/^[\d.]+$/)) {
                  radius = radiusValue;
                } else {
                  const dx = point.x - center.x;
                  const dy = point.y - center.y;
                  radius = Math.sqrt(dx * dx + dy * dy);
                }

                createCircle(center, radius);
                clearDrawingPoints();
                setDrawingPreview(null);
                addMessage(`Circle created with radius: ${radius.toFixed(2)}`);
              }
              break;
          }
          return;
        }
      }

      if (trimmed) {
        addMessage(`Unknown command: ${trimmed}`);
      }
    },
    [
      hasActiveCommand,
      commandState,
      addDrawingPoint,
      clearDrawingPoints,
      setDrawingPreview,
      createLine,
      createRectangle,
      createCircle,
      handleDrawingOption,
      applyCommandResult,
      addMessage,
      setActiveTool,
    ]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleCommand(currentCommand);
      setCurrentCommand('');
      setHistoryIndex(-1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setCurrentCommand(commandHistory[commandHistory.length - 1 - newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setCurrentCommand(commandHistory[commandHistory.length - 1 - newIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCurrentCommand('');
      }
    } else if (e.key === 'Escape') {
      if (hasActiveCommand) {
        const input: CommandInput = { type: 'escape' };
        const result = processCommandInput(commandState, input, useAppStore.getState().shapes);
        applyCommandResult(result);
        setCommandState(createInitialCommandState());
      } else if (isDrawing) {
        handleDrawingOption('Cancel');
      }
      setCurrentCommand('');
      setHistoryIndex(-1);
    }
  };

  // Watch for pending commands from ToolPalette/Ribbon
  useEffect(() => {
    if (pendingCommand) {
      const commandName = resolveCommandName(pendingCommand);

      if (commandName) {
        const newState = startCommand(commandName, createInitialCommandState(), useAppStore.getState().selectedShapeIds);
        setCommandState(newState);
        addMessage(commandName);
      } else {
        handleCommand(pendingCommand);
      }

      setPendingCommand(null);
    }
  }, [pendingCommand, setPendingCommand, addMessage, handleCommand]);

  // Update hasActiveModifyCommand, activeCommandName, and commandIsSelecting when command state changes
  useEffect(() => {
    setHasActiveModifyCommand(hasActiveCommand);
    setActiveCommandName(hasActiveCommand ? commandState.activeCommand : null);
    setCommandIsSelecting(hasActiveCommand && commandState.phase === 'selecting');
    setCommandBasePoint(hasActiveCommand ? commandState.basePoint : null);
    if (!hasActiveCommand) {
      setCommandPreviewShapes([]);
    }
  }, [hasActiveCommand, commandState.activeCommand, commandState.phase, commandState.basePoint, setHasActiveModifyCommand, setActiveCommandName, setCommandIsSelecting, setCommandPreviewShapes, setCommandBasePoint]);

  // Update command preview shapes on mouse move
  useEffect(() => {
    if (!hasActiveCommand) {
      return;
    }

    const s = useAppStore.getState();
    const worldX = (mousePosition.x - s.viewport.offsetX) / s.viewport.zoom;
    const worldY = (mousePosition.y - s.viewport.offsetY) / s.viewport.zoom;

    // Use the full snap detection result if available (set by useCanvasEvents mouse move)
    const currentPoint = s.currentSnapPoint
      ? s.currentSnapPoint.point
      : s.snapEnabled
        ? { x: Math.round(worldX / s.gridSize) * s.gridSize, y: Math.round(worldY / s.gridSize) * s.gridSize }
        : { x: worldX, y: worldY };
    const previewShapes = getCommandPreview(commandState, currentPoint, s.shapes);
    setCommandPreviewShapes(previewShapes);
  }, [hasActiveCommand, mousePosition, commandState, setCommandPreviewShapes]);

  // Process pending points from canvas clicks
  useEffect(() => {
    if (pendingCommandPoint && hasActiveCommand) {
      const input: CommandInput = { type: 'point', point: pendingCommandPoint };
      const result = processCommandInput(commandState, input, useAppStore.getState().shapes);
      applyCommandResult(result);
      setPendingCommandPoint(null);
    }
  }, [pendingCommandPoint, hasActiveCommand, commandState, applyCommandResult, setPendingCommandPoint]);

  // Process pending selections from canvas clicks during command selection phase
  useEffect(() => {
    if (pendingCommandSelection && hasActiveCommand && commandState.phase === 'selecting') {
      const input: CommandInput = { type: 'selection', ids: pendingCommandSelection };
      const result = processCommandInput(commandState, input, useAppStore.getState().shapes);
      applyCommandResult(result);
      setPendingCommandSelection(null);
    }
  }, [pendingCommandSelection, hasActiveCommand, commandState, applyCommandResult, setPendingCommandSelection]);

  // Watch for command cancel requests (e.g., when user switches to drawing tool)
  useEffect(() => {
    if (pendingCommandCancel && hasActiveCommand) {
      // Cancel the active command
      setCommandState(createInitialCommandState());
      setCommandPreviewShapes([]);
      deselectAll();
      addMessage('*Cancel*');
      // Clear the request
      clearCommandCancelRequest();
    } else if (pendingCommandCancel) {
      // No active command, just clear the request
      clearCommandCancelRequest();
    }
  }, [pendingCommandCancel, hasActiveCommand, clearCommandCancelRequest, setCommandPreviewShapes, deselectAll, addMessage]);

  // Auto-scroll history
  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input on key press
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't steal focus from inputs or textareas
      const tagName = document.activeElement?.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA') return;

      // Focus command line on typing
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        inputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const options = getOptions();
  const prompt = getPrompt();

  return (
    <div className="bg-cad-bg border-t border-cad-border flex flex-col">
      {/* Message History */}
      <div
        ref={historyRef}
        className="h-16 overflow-y-auto px-2 py-1 font-mono text-xs text-cad-text-dim"
      >
        {messages.map((msg, i) => (
          <div key={i} className="leading-tight">
            {msg}
          </div>
        ))}
      </div>

      {/* Command Input */}
      <div className="h-8 flex items-center px-2 border-t border-cad-border">
        <span className="text-cad-accent mr-2 font-mono text-sm whitespace-nowrap">
          {prompt}
        </span>
        <input
          ref={inputRef}
          type="text"
          value={currentCommand}
          onChange={(e) => setCurrentCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent border-none outline-none text-cad-text font-mono text-sm min-w-0"
          placeholder={
            hasActiveCommand
              ? 'Enter value, coordinates, or select option'
              : isDrawing
              ? 'Enter coordinates (100,50), relative (@50,25), polar (@100<45), or distance (100)'
              : ''
          }
          autoComplete="off"
          spellCheck={false}
        />

        {/* Option Buttons */}
        {options.length > 0 && (
          <div className="flex items-center gap-1 ml-2 flex-wrap">
            {options.map((option) => (
              <button
                key={option}
                onClick={() => handleOption(option)}
                className="px-2 py-0.5 text-xs font-mono bg-cad-surface hover:bg-cad-accent hover:text-cad-bg rounded border border-cad-border transition-colors"
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
