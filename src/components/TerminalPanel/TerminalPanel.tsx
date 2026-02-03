import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { X, Minimize2, Maximize2, Terminal as TerminalIcon } from 'lucide-react';
import { executeClaudeCadCommand } from '../../services/claudeCadService';
import '@xterm/xterm/css/xterm.css';

/**
 * Get available commands from CAD API for display
 */
function getAvailableCommands(): { category: string; commands: string[] }[] {
  const cad = (window as any).cad;
  if (!cad || typeof cad.getMcpTools !== 'function') {
    return [];
  }

  const tools = cad.getMcpTools();
  const grouped: Record<string, string[]> = {};

  for (const tool of tools) {
    const parts = tool.name.split('_');
    const category = parts[1] || 'other';
    const action = parts.slice(2).join('_');
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(action);
  }

  return Object.entries(grouped).map(([category, commands]) => ({
    category,
    commands,
  }));
}

interface ShellResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

interface TerminalPanelProps {
  isOpen: boolean;
  onClose: () => void;
  height: number;
  onHeightChange: (height: number) => void;
}

type TerminalMode = 'shell' | 'ai';

export function TerminalPanel({ isOpen, onClose, height, onHeightChange }: TerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [mode, setMode] = useState<TerminalMode>('ai');
  const isResizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  // Use refs for values that need to be accessed in callbacks
  const currentLineRef = useRef('');
  const cursorPosRef = useRef(0); // Cursor position within current line
  const commandHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const modeRef = useRef<TerminalMode>('ai');

  // Keep modeRef in sync
  modeRef.current = mode;

  const PROMPT_SHELL = '\x1b[32m$\x1b[0m ';
  const PROMPT_AI = '\x1b[35mAI>\x1b[0m ';
  const getPrompt = () => modeRef.current === 'ai' ? PROMPT_AI : PROMPT_SHELL;

  const writePrompt = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.write('\r\n' + getPrompt());
    }
  }, []);

  const executeCommand = useCallback(async (command: string) => {
    const term = xtermRef.current;
    if (!term) return;

    const trimmedCmd = command.trim();
    if (!trimmedCmd) {
      writePrompt();
      return;
    }

    // Add to history
    const newHistory = [...commandHistoryRef.current.filter(c => c !== trimmedCmd), trimmedCmd].slice(-100);
    commandHistoryRef.current = newHistory;
    historyIndexRef.current = -1;

    term.write('\r\n');

    // Parse command
    const parts = trimmedCmd.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    try {
      // Common commands available in both modes
      if (cmd === 'clear' || cmd === 'cls') {
        term.clear();
        term.write(getPrompt());
        return;
      }

      if (cmd === 'exit') {
        onClose();
        return;
      }

      if (cmd === 'help') {
        if (modeRef.current === 'ai') {
          term.write('\x1b[36m┌─────────────────────────────────────────────┐\x1b[0m\r\n');
          term.write('\x1b[36m│\x1b[0m  \x1b[1;35mAI Mode Help\x1b[0m                              \x1b[36m│\x1b[0m\r\n');
          term.write('\x1b[36m└─────────────────────────────────────────────┘\x1b[0m\r\n');
          term.write('\r\n');
          term.write('\x1b[33mJust type what you want in natural language:\x1b[0m\r\n');
          term.write('\r\n');
          term.write('\x1b[32mDrawing:\x1b[0m\r\n');
          term.write('  "draw a line from 100,100 to 300,200"\r\n');
          term.write('  "draw a red circle with radius 50"\r\n');
          term.write('  "draw a blue filled rectangle"\r\n');
          term.write('  "draw a triangle" / "draw a house"\r\n');
          term.write('  "draw a diagonal hatch pattern"\r\n');
          term.write('\r\n');
          term.write('\x1b[32mEditing:\x1b[0m\r\n');
          term.write('  "select all circles" / "delete selected"\r\n');
          term.write('  "move selection right 50 pixels"\r\n');
          term.write('  "rotate selected 45 degrees"\r\n');
          term.write('  "copy selected" / "mirror selected"\r\n');
          term.write('\r\n');
          term.write('\x1b[32mView & Other:\x1b[0m\r\n');
          term.write('  "zoom to fit" / "zoom in" / "zoom out"\r\n');
          term.write('  "undo" / "redo"\r\n');
          term.write('  "create a layer called Walls"\r\n');
          term.write('\r\n');
          term.write('\x1b[90mType "commands" for full API reference\x1b[0m\r\n');
          term.write('\x1b[90mSwitch to Shell mode for git commands\x1b[0m\r\n');
        } else {
          term.write('\x1b[36mShell Mode Commands:\x1b[0m\r\n');
          term.write('  \x1b[33mgit\x1b[0m <args>    - Run git commands\r\n');
          term.write('  \x1b[33mclear\x1b[0m         - Clear terminal\r\n');
          term.write('  \x1b[33mexit\x1b[0m          - Close terminal\r\n');
          term.write('\r\n\x1b[90mSwitch to AI mode to draw with natural language\x1b[0m\r\n');
        }
        writePrompt();
        return;
      }

      // Commands list - show full API reference
      if (cmd === 'commands' || cmd === 'cmds' || cmd === 'api') {
        const cmdGroups = getAvailableCommands();
        term.write('\x1b[36m┌─────────────────────────────────────────────┐\x1b[0m\r\n');
        term.write('\x1b[36m│\x1b[0m  \x1b[1;35mAvailable Commands (Full List)\x1b[0m            \x1b[36m│\x1b[0m\r\n');
        term.write('\x1b[36m└─────────────────────────────────────────────┘\x1b[0m\r\n');
        term.write('\r\n');

        if (cmdGroups.length > 0) {
          for (const group of cmdGroups) {
            term.write(`\x1b[32m${group.category.toUpperCase()}:\x1b[0m\r\n`);
            // Show commands in rows of 4
            for (let i = 0; i < group.commands.length; i += 4) {
              const row = group.commands.slice(i, i + 4);
              term.write('  ' + row.map(c => c.padEnd(15)).join('') + '\r\n');
            }
            term.write('\r\n');
          }
        } else {
          term.write('\x1b[90mNo commands available (CAD API not loaded)\x1b[0m\r\n');
        }

        term.write('\x1b[90mUse natural language, e.g., "draw a line" or "zoom to fit"\x1b[0m\r\n');
        writePrompt();
        return;
      }

      // AI Mode - send everything to Claude
      if (modeRef.current === 'ai') {
        // Show spinner animation while waiting
        const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        let spinnerIndex = 0;
        term.write('\x1b[36m' + spinnerFrames[0] + ' Thinking...\x1b[0m');

        const spinnerInterval = setInterval(() => {
          spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
          // Move cursor back to start of line and rewrite
          term.write('\r\x1b[36m' + spinnerFrames[spinnerIndex] + ' Thinking...\x1b[0m');
        }, 80);

        try {
          const result = await executeClaudeCadCommand(trimmedCmd);

          clearInterval(spinnerInterval);
          // Clear the thinking line and write result
          term.write('\r\x1b[K'); // Clear line

          if (result.success) {
            term.write('\x1b[32mDone!\x1b[0m');
          } else {
            term.write(`\x1b[31mError: ${result.error}\x1b[0m`);
          }
        } catch (err) {
          clearInterval(spinnerInterval);
          term.write('\r\x1b[K'); // Clear line
          term.write(`\x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
        }

        writePrompt();
        return;
      }

      // Shell Mode - execute commands
      let shellCmd: string;
      let shellArgs: string[];

      if (cmd === 'git') {
        shellCmd = 'git';
        shellArgs = args;
      } else {
        // For other commands, use cmd /c on Windows
        shellCmd = 'cmd';
        shellArgs = ['/c', trimmedCmd];
      }

      const output = await invoke<ShellResult>('execute_shell', {
        program: shellCmd,
        args: shellArgs,
      });

      if (output.stdout) {
        // Convert newlines and write output
        const lines = output.stdout.split('\n');
        lines.forEach((line, i) => {
          term.write(line);
          if (i < lines.length - 1) term.write('\r\n');
        });
      }

      if (output.stderr) {
        term.write('\x1b[31m'); // Red color
        const lines = output.stderr.split('\n');
        lines.forEach((line, i) => {
          term.write(line);
          if (i < lines.length - 1) term.write('\r\n');
        });
        term.write('\x1b[0m'); // Reset color
      }

      if (output.code !== 0) {
        term.write(`\r\n\x1b[31mProcess exited with code ${output.code}\x1b[0m`);
      }
    } catch (error) {
      term.write(`\x1b[31mError: ${error instanceof Error ? error.message : String(error)}\x1b[0m`);
    }

    writePrompt();
  }, [writePrompt, onClose]);

  // Initialize terminal
  useEffect(() => {
    if (!isOpen || !terminalRef.current || xtermRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Welcome message
    term.write('\x1b[36m╔══════════════════════════════════════════════════════════════╗\x1b[0m\r\n');
    term.write('\x1b[36m║\x1b[0m      \x1b[1;35mOpen 2D Studio - AI Command Interface\x1b[0m                  \x1b[36m║\x1b[0m\r\n');
    term.write('\x1b[36m╚══════════════════════════════════════════════════════════════╝\x1b[0m\r\n');
    term.write('\r\n');
    term.write('\x1b[32mI know all commands!\x1b[0m Just type what you want to do.\r\n');
    term.write('\r\n');
    term.write('\x1b[90mExamples: "draw a circle", "undo", "zoom to fit"\x1b[0m\r\n');
    term.write('\x1b[90mType "help" for more info, "commands" for full list\x1b[0m\r\n');
    term.write('\r\n');
    term.write(PROMPT_AI);

    // Helper to redraw line from cursor position
    const redrawLine = () => {
      const line = currentLineRef.current;
      const pos = cursorPosRef.current;
      // Move to start of line, write prompt + full line, position cursor
      term.write('\r' + getPrompt() + line + ' '); // Extra space to clear any leftover char
      // Move cursor back to correct position
      const moveBack = line.length - pos + 1; // +1 for the extra space
      if (moveBack > 0) {
        term.write(`\x1b[${moveBack}D`);
      }
    };

    // Handle input
    term.onData((data) => {
      const code = data.charCodeAt(0);

      if (code === 13) {
        // Enter
        executeCommand(currentLineRef.current);
        currentLineRef.current = '';
        cursorPosRef.current = 0;
      } else if (code === 127 || code === 8) {
        // Backspace - delete character before cursor
        if (cursorPosRef.current > 0) {
          const line = currentLineRef.current;
          const pos = cursorPosRef.current;
          currentLineRef.current = line.slice(0, pos - 1) + line.slice(pos);
          cursorPosRef.current = pos - 1;
          redrawLine();
        }
      } else if (code === 27) {
        // Escape sequences (arrows, etc.)
        if (data === '\x1b[A') {
          // Up arrow - previous command
          const history = commandHistoryRef.current;
          const newIndex = Math.min(historyIndexRef.current + 1, history.length - 1);
          if (newIndex >= 0 && history.length > 0) {
            const historyCmd = history[history.length - 1 - newIndex];
            // Clear current line and show history command
            term.write('\r' + getPrompt() + ' '.repeat(currentLineRef.current.length) + '\r' + getPrompt() + historyCmd);
            currentLineRef.current = historyCmd;
            cursorPosRef.current = historyCmd.length;
            historyIndexRef.current = newIndex;
          }
        } else if (data === '\x1b[B') {
          // Down arrow - next command
          const history = commandHistoryRef.current;
          const newIndex = Math.max(historyIndexRef.current - 1, -1);
          if (newIndex >= 0) {
            const historyCmd = history[history.length - 1 - newIndex];
            term.write('\r' + getPrompt() + ' '.repeat(currentLineRef.current.length) + '\r' + getPrompt() + historyCmd);
            currentLineRef.current = historyCmd;
            cursorPosRef.current = historyCmd.length;
          } else {
            term.write('\r' + getPrompt() + ' '.repeat(currentLineRef.current.length) + '\r' + getPrompt());
            currentLineRef.current = '';
            cursorPosRef.current = 0;
          }
          historyIndexRef.current = newIndex;
        } else if (data === '\x1b[C') {
          // Right arrow - move cursor right
          if (cursorPosRef.current < currentLineRef.current.length) {
            cursorPosRef.current++;
            term.write('\x1b[C'); // Move cursor right
          }
        } else if (data === '\x1b[D') {
          // Left arrow - move cursor left
          if (cursorPosRef.current > 0) {
            cursorPosRef.current--;
            term.write('\x1b[D'); // Move cursor left
          }
        } else if (data === '\x1b[H' || data === '\x1b[1~') {
          // Home key - move to start of line
          if (cursorPosRef.current > 0) {
            term.write(`\x1b[${cursorPosRef.current}D`);
            cursorPosRef.current = 0;
          }
        } else if (data === '\x1b[F' || data === '\x1b[4~') {
          // End key - move to end of line
          const moveRight = currentLineRef.current.length - cursorPosRef.current;
          if (moveRight > 0) {
            term.write(`\x1b[${moveRight}C`);
            cursorPosRef.current = currentLineRef.current.length;
          }
        } else if (data === '\x1b[3~') {
          // Delete key - delete character at cursor
          if (cursorPosRef.current < currentLineRef.current.length) {
            const line = currentLineRef.current;
            const pos = cursorPosRef.current;
            currentLineRef.current = line.slice(0, pos) + line.slice(pos + 1);
            redrawLine();
          }
        }
      } else if (code === 3) {
        // Ctrl+C
        term.write('^C');
        currentLineRef.current = '';
        cursorPosRef.current = 0;
        writePrompt();
      } else if (code >= 32) {
        // Printable characters - insert at cursor position
        const line = currentLineRef.current;
        const pos = cursorPosRef.current;
        currentLineRef.current = line.slice(0, pos) + data + line.slice(pos);
        cursorPosRef.current = pos + data.length;

        if (pos === line.length) {
          // Appending at end - just write the character
          term.write(data);
        } else {
          // Inserting in middle - redraw from cursor
          redrawLine();
        }
      }
    });

    return () => {
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [isOpen]);

  // Handle resize
  useEffect(() => {
    if (!isOpen) return;

    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
      }
    };

    const observer = new ResizeObserver(handleResize);
    if (terminalRef.current) {
      observer.observe(terminalRef.current);
    }

    window.addEventListener('resize', handleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [isOpen]);

  // Resize handle
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = startYRef.current - e.clientY;
      const newHeight = Math.max(100, Math.min(600, startHeightRef.current + delta));
      onHeightChange(newHeight);
    };

    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [onHeightChange]);

  if (!isOpen) return null;

  const panelHeight = isMaximized ? 'calc(100vh - 200px)' : `${height}px`;

  return (
    <div
      className="flex flex-col bg-[#1e1e1e] border-t border-cad-border"
      style={{ height: panelHeight }}
    >
      {/* Resize handle */}
      <div
        className="h-1 cursor-ns-resize hover:bg-cad-accent"
        onMouseDown={(e) => {
          e.preventDefault();
          isResizingRef.current = true;
          startYRef.current = e.clientY;
          startHeightRef.current = height;
          document.body.style.cursor = 'ns-resize';
          document.body.style.userSelect = 'none';
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 bg-cad-surface border-b border-cad-border">
        <div className="flex items-center gap-3">
          <TerminalIcon size={14} className="text-cad-text-dim" />
          {/* Mode Toggle */}
          <div className="flex items-center bg-cad-bg rounded overflow-hidden">
            <button
              onClick={() => {
                setMode('ai');
                if (xtermRef.current) {
                  xtermRef.current.write('\r\n\x1b[35mSwitched to AI mode\x1b[0m\r\n' + PROMPT_AI);
                  currentLineRef.current = '';
                  cursorPosRef.current = 0;
                }
              }}
              className={`px-2 py-0.5 text-xs font-medium transition-colors ${
                mode === 'ai'
                  ? 'bg-purple-600 text-white'
                  : 'text-cad-text-dim hover:text-cad-text'
              }`}
              title="AI Mode - Natural language commands"
            >
              AI
            </button>
            <button
              onClick={() => {
                setMode('shell');
                if (xtermRef.current) {
                  xtermRef.current.write('\r\n\x1b[32mSwitched to Shell mode\x1b[0m\r\n' + PROMPT_SHELL);
                  currentLineRef.current = '';
                  cursorPosRef.current = 0;
                }
              }}
              className={`px-2 py-0.5 text-xs font-medium transition-colors ${
                mode === 'shell'
                  ? 'bg-green-600 text-white'
                  : 'text-cad-text-dim hover:text-cad-text'
              }`}
              title="Shell Mode - Git and system commands"
            >
              Shell
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1 hover:bg-cad-bg rounded"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-cad-bg rounded"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Terminal */}
      <div ref={terminalRef} className="flex-1 overflow-hidden" />
    </div>
  );
}
