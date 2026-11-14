using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace OmniDeskAgent
{
    internal static class NativeWin32
    {
        public const int INPUT_MOUSE = 0;
        public const int INPUT_KEYBOARD = 1;

        public const uint MOUSEEVENTF_MOVE = 0x0001;
        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
        public const uint MOUSEEVENTF_HWHEEL = 0x01000;
        public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;

        public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_UNICODE = 0x0004;

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT
        {
            public uint type;
            public InputUnion U;
            public static int Size
            {
                get { return Marshal.SizeOf(typeof(INPUT)); }
            }
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion
        {
            [FieldOffset(0)]
            public MOUSEINPUT mi;
            [FieldOffset(0)]
            public KEYBDINPUT ki;
            [FieldOffset(0)]
            public HARDWAREINPUT hi;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct HARDWAREINPUT
        {
            public uint uMsg;
            public ushort wParamL;
            public ushort wParamH;
        }

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, [MarshalAs(UnmanagedType.LPArray), In] INPUT[] pInputs, int cbSize);

        [DllImport("user32.dll")]
        public static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        public static extern bool LockWorkStation();

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        public const int WM_CLIPBOARDUPDATE = 0x031D;

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool AddClipboardFormatListener(IntPtr hwnd);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool RemoveClipboardFormatListener(IntPtr hwnd);
    }

    internal sealed class InputExecutor
    {
        private readonly HashSet<ushort> _pressedVks = new HashSet<ushort>();
        private readonly object _lock = new object();

        public long EventsExecuted { get; private set; }

        public void Execute(Dictionary<string, string> pkt)
        {
            string kind;
            if (!pkt.TryGetValue("kind", out kind)) return;

            lock (_lock)
            {
                EventsExecuted++;

                if (kind == "mouse-move")
                {
                    double x = Clamp01(ParseDouble(pkt, "x", 0));
                    double y = Clamp01(ParseDouble(pkt, "y", 0));
                    SendMouseMove(x, y);
                }
                else if (kind == "mouse-down" || kind == "mouse-up")
                {
                    double x = Clamp01(ParseDouble(pkt, "x", 0));
                    double y = Clamp01(ParseDouble(pkt, "y", 0));
                    string button;
                    if (!pkt.TryGetValue("button", out button)) button = "left";
                    bool isDown = (kind == "mouse-down");
                    SendMouseButton(x, y, button, isDown);
                }
                else if (kind == "mouse-wheel")
                {
                    double dx = ParseDouble(pkt, "deltaX", 0);
                    double dy = ParseDouble(pkt, "deltaY", 0);
                    SendMouseWheel(dx, dy);
                }
                else if (kind == "key-down" || kind == "key-up")
                {
                    string key = "";
                    string code = "";
                    pkt.TryGetValue("key", out key);
                    pkt.TryGetValue("code", out code);
                    bool isDown = (kind == "key-down");
                    SendKey(key ?? "", code ?? "", isDown);
                }
                else if (kind == "special-key")
                {
                    string action;
                    if (!pkt.TryGetValue("action", out action)) return;
                    if (action == "esc")
                    {
                        SendVk(0x1B, false, true);
                        SendVk(0x1B, false, false);
                    }
                    else if (action == "lock")
                    {
                        NativeWin32.LockWorkStation();
                    }
                    else if (action == "ctrl-alt-del")
                    {
                        // User-mode processes cannot synthesize kernel SAS CAD; open Task Manager via Ctrl+Shift+Esc
                        SendVk(0xA2, false, true);
                        SendVk(0xA0, false, true);
                        SendVk(0x1B, false, true);
                        SendVk(0x1B, false, false);
                        SendVk(0xA0, false, false);
                        SendVk(0xA2, false, false);
                    }
                }
                else if (kind == "release-all")
                {
                    ReleaseAllHeldInputs();
                }
            }
        }

        public void ReleaseAllHeldInputs()
        {
            lock (_lock)
            {
                ushort[] modifiers = new ushort[] { 0x10, 0x11, 0x12, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0x5B, 0x5C };
                foreach (ushort vk in _pressedVks)
                {
                    SendVk(vk, IsExtendedVk(vk), false);
                }
                _pressedVks.Clear();

                foreach (ushort mod in modifiers)
                {
                    SendVk(mod, IsExtendedVk(mod), false);
                }

                // Release mouse buttons cleanly
                NativeWin32.INPUT[] ups = new NativeWin32.INPUT[3];
                ups[0].type = NativeWin32.INPUT_MOUSE;
                ups[0].U.mi.dwFlags = NativeWin32.MOUSEEVENTF_LEFTUP;
                ups[1].type = NativeWin32.INPUT_MOUSE;
                ups[1].U.mi.dwFlags = NativeWin32.MOUSEEVENTF_RIGHTUP;
                ups[2].type = NativeWin32.INPUT_MOUSE;
                ups[2].U.mi.dwFlags = NativeWin32.MOUSEEVENTF_MIDDLEUP;
                NativeWin32.SendInput((uint)ups.Length, ups, NativeWin32.INPUT.Size);
            }
        }

        private int _lastAbsX = -1;
        private int _lastAbsY = -1;

        private void SendMouseMove(double x, double y, bool force = false)
        {
            int absX = (int)Math.Round(x * 65535.0);
            int absY = (int)Math.Round(y * 65535.0);
            if (!force && absX == _lastAbsX && absY == _lastAbsY)
            {
                return;
            }
            _lastAbsX = absX;
            _lastAbsY = absY;

            NativeWin32.INPUT[] inputs = new NativeWin32.INPUT[1];
            inputs[0].type = NativeWin32.INPUT_MOUSE;
            inputs[0].U.mi.dx = absX;
            inputs[0].U.mi.dy = absY;
            inputs[0].U.mi.dwFlags = NativeWin32.MOUSEEVENTF_MOVE | NativeWin32.MOUSEEVENTF_ABSOLUTE;
            NativeWin32.SendInput(1, inputs, NativeWin32.INPUT.Size);
        }

        public void TriggerCtrlV()
        {
            ushort[] modsToRelease = new ushort[] { 0x12, 0xA4, 0xA5, 0x10, 0xA0, 0xA1, 0x5B, 0x5C };
            for (int i = 0; i < modsToRelease.Length; i++)
            {
                ushort m = modsToRelease[i];
                SendVk(m, IsExtendedVk(m), false);
            }
            Thread.Sleep(20);

            NativeWin32.INPUT[] inputs = new NativeWin32.INPUT[4];
            inputs[0].type = NativeWin32.INPUT_KEYBOARD;
            inputs[0].U.ki.wVk = 0x11; // VK_CONTROL
            inputs[1].type = NativeWin32.INPUT_KEYBOARD;
            inputs[1].U.ki.wVk = 0x56; // VK_V
            inputs[2].type = NativeWin32.INPUT_KEYBOARD;
            inputs[2].U.ki.wVk = 0x56;
            inputs[2].U.ki.dwFlags = NativeWin32.KEYEVENTF_KEYUP;
            inputs[3].type = NativeWin32.INPUT_KEYBOARD;
            inputs[3].U.ki.wVk = 0x11;
            inputs[3].U.ki.dwFlags = NativeWin32.KEYEVENTF_KEYUP;
            NativeWin32.SendInput(4, inputs, NativeWin32.INPUT.Size);
            lock (_lock)
            {
                EventsExecuted++;
            }
        }

        private void SendMouseButton(double x, double y, string button, bool isDown)
        {
            SendMouseMove(x, y, true);

            uint flag;
            if (button == "right")
            {
                flag = isDown ? NativeWin32.MOUSEEVENTF_RIGHTDOWN : NativeWin32.MOUSEEVENTF_RIGHTUP;
            }
            else if (button == "middle")
            {
                flag = isDown ? NativeWin32.MOUSEEVENTF_MIDDLEDOWN : NativeWin32.MOUSEEVENTF_MIDDLEUP;
            }
            else
            {
                flag = isDown ? NativeWin32.MOUSEEVENTF_LEFTDOWN : NativeWin32.MOUSEEVENTF_LEFTUP;
            }

            NativeWin32.INPUT[] inputs = new NativeWin32.INPUT[1];
            inputs[0].type = NativeWin32.INPUT_MOUSE;
            inputs[0].U.mi.dwFlags = flag;
            NativeWin32.SendInput(1, inputs, NativeWin32.INPUT.Size);
        }

        private static void SendMouseWheel(double deltaX, double deltaY)
        {
            List<NativeWin32.INPUT> list = new List<NativeWin32.INPUT>();
            if (Math.Abs(deltaY) > 0.001)
            {
                int wheelAmount = (int)Math.Round(-deltaY * 120.0);
                NativeWin32.INPUT inp = new NativeWin32.INPUT();
                inp.type = NativeWin32.INPUT_MOUSE;
                inp.U.mi.dwFlags = NativeWin32.MOUSEEVENTF_WHEEL;
                inp.U.mi.mouseData = unchecked((uint)wheelAmount);
                list.Add(inp);
            }
            if (Math.Abs(deltaX) > 0.001)
            {
                int hwheelAmount = (int)Math.Round(deltaX * 120.0);
                NativeWin32.INPUT inp = new NativeWin32.INPUT();
                inp.type = NativeWin32.INPUT_MOUSE;
                inp.U.mi.dwFlags = NativeWin32.MOUSEEVENTF_HWHEEL;
                inp.U.mi.mouseData = unchecked((uint)hwheelAmount);
                list.Add(inp);
            }
            if (list.Count > 0)
            {
                NativeWin32.INPUT[] arr = list.ToArray();
                NativeWin32.SendInput((uint)arr.Length, arr, NativeWin32.INPUT.Size);
            }
        }

        private void SendKey(string key, string code, bool isDown)
        {
            // Prefer Unicode injection for non-ASCII printable characters (accents, ç, etc.)
            if (key.Length == 1 && key[0] > 127)
            {
                SendUnicodeChar(key[0], isDown);
                return;
            }

            bool extended;
            ushort vk = ResolveVirtualKey(code, key, out extended);
            if (vk != 0)
            {
                if (isDown) _pressedVks.Add(vk);
                else _pressedVks.Remove(vk);
                SendVk(vk, extended, isDown);
            }
            else if (key.Length == 1)
            {
                SendUnicodeChar(key[0], isDown);
            }
        }

        private static void SendVk(ushort vk, bool extended, bool isDown)
        {
            uint flags = isDown ? 0u : NativeWin32.KEYEVENTF_KEYUP;
            if (extended) flags |= NativeWin32.KEYEVENTF_EXTENDEDKEY;

            NativeWin32.INPUT[] inputs = new NativeWin32.INPUT[1];
            inputs[0].type = NativeWin32.INPUT_KEYBOARD;
            inputs[0].U.ki.wVk = vk;
            inputs[0].U.ki.dwFlags = flags;
            NativeWin32.SendInput(1, inputs, NativeWin32.INPUT.Size);
        }

        private static void SendUnicodeChar(char ch, bool isDown)
        {
            uint flags = NativeWin32.KEYEVENTF_UNICODE | (isDown ? 0u : NativeWin32.KEYEVENTF_KEYUP);
            NativeWin32.INPUT[] inputs = new NativeWin32.INPUT[1];
            inputs[0].type = NativeWin32.INPUT_KEYBOARD;
            inputs[0].U.ki.wVk = 0;
            inputs[0].U.ki.wScan = ch;
            inputs[0].U.ki.dwFlags = flags;
            NativeWin32.SendInput(1, inputs, NativeWin32.INPUT.Size);
        }

        private static bool IsExtendedVk(ushort vk)
        {
            return vk == 0x21 || vk == 0x22 || vk == 0x23 || vk == 0x24 ||
                   vk == 0x25 || vk == 0x26 || vk == 0x27 || vk == 0x28 ||
                   vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5C ||
                   vk == 0xA3 || vk == 0xA5 || vk == 0x6F;
        }

        private static ushort ResolveVirtualKey(string code, string key, out bool extended)
        {
            extended = false;
            if (!string.IsNullOrEmpty(code))
            {
                if (code.StartsWith("Key") && code.Length == 4)
                {
                    char c = char.ToUpperInvariant(code[3]);
                    if (c >= 'A' && c <= 'Z') return (ushort)c;
                }
                if (code.StartsWith("Digit") && code.Length == 6)
                {
                    char d = code[5];
                    if (d >= '0' && d <= '9') return (ushort)d;
                }
                if (code.StartsWith("Numpad") && code.Length == 7 && code[6] >= '0' && code[6] <= '9')
                {
                    return (ushort)(0x60 + (code[6] - '0'));
                }
                if (code.StartsWith("F"))
                {
                    int fn;
                    if (int.TryParse(code.Substring(1), out fn) && fn >= 1 && fn <= 24)
                    {
                        return (ushort)(0x70 + fn - 1);
                    }
                }

                switch (code)
                {
                    case "Enter": return 0x0D;
                    case "NumpadEnter": extended = true; return 0x0D;
                    case "Escape": return 0x1B;
                    case "Backspace": return 0x08;
                    case "Tab": return 0x09;
                    case "Space": return 0x20;
                    case "CapsLock": return 0x14;
                    case "ShiftLeft": return 0xA0;
                    case "ShiftRight": return 0xA1;
                    case "ControlLeft": return 0xA2;
                    case "ControlRight": extended = true; return 0xA3;
                    case "AltLeft": return 0xA4;
                    case "AltRight": extended = true; return 0xA5;
                    case "MetaLeft": extended = true; return 0x5B;
                    case "MetaRight": extended = true; return 0x5C;
                    case "ContextMenu": extended = true; return 0x5D;
                    case "Insert": extended = true; return 0x2D;
                    case "Delete": extended = true; return 0x2E;
                    case "Home": extended = true; return 0x24;
                    case "End": extended = true; return 0x23;
                    case "PageUp": extended = true; return 0x21;
                    case "PageDown": extended = true; return 0x22;
                    case "ArrowLeft": extended = true; return 0x25;
                    case "ArrowUp": extended = true; return 0x26;
                    case "ArrowRight": extended = true; return 0x27;
                    case "ArrowDown": extended = true; return 0x28;
                    case "NumLock": extended = true; return 0x90;
                    case "ScrollLock": return 0x91;
                    case "Pause": return 0x13;
                    case "PrintScreen": extended = true; return 0x2C;
                    case "NumpadMultiply": return 0x6A;
                    case "NumpadAdd": return 0x6B;
                    case "NumpadSubtract": return 0x6D;
                    case "NumpadDecimal": return 0x6E;
                    case "NumpadDivide": extended = true; return 0x6F;
                    case "Semicolon": return 0xBA;
                    case "Equal": return 0xBB;
                    case "Comma": return 0xBC;
                    case "Minus": return 0xBD;
                    case "Period": return 0xBE;
                    case "Slash": return 0xBF;
                    case "Backquote": return 0xC0;
                    case "BracketLeft": return 0xDB;
                    case "Backslash": return 0xDC;
                    case "BracketRight": return 0xDD;
                    case "Quote": return 0xDE;
                    case "IntlBackslash": return 0xE2;
                    case "IntlRo": return 0xC1;
                }
            }

            if (key == "Enter") return 0x0D;
            if (key == "Escape") return 0x1B;
            if (key == "Backspace") return 0x08;
            if (key == "Tab") return 0x09;
            if (key == " ") return 0x20;
            if (key.Length == 1)
            {
                char ch = char.ToUpperInvariant(key[0]);
                if ((ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9'))
                {
                    return (ushort)ch;
                }
            }
            return 0;
        }

        private static double Clamp01(double v)
        {
            if (v < 0) return 0;
            if (v > 1) return 1;
            return v;
        }

        private static double ParseDouble(Dictionary<string, string> pkt, string field, double fallback)
        {
            string raw;
            if (!pkt.TryGetValue(field, out raw)) return fallback;
            double val;
            if (double.TryParse(raw, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out val))
            {
                return val;
            }
            return fallback;
        }
    }

    internal static class FlatJsonParser
    {
        public static Dictionary<string, string> ParseObject(string json)
        {
            Dictionary<string, string> result = new Dictionary<string, string>(StringComparer.Ordinal);
            if (string.IsNullOrEmpty(json)) return result;

            int i = 0;
            int n = json.Length;
            SkipWs(json, ref i, n);
            if (i >= n || json[i] != '{') return result;
            i++;

            while (i < n)
            {
                SkipWs(json, ref i, n);
                if (i >= n || json[i] == '}') break;
                if (json[i] == ',') { i++; continue; }
                if (json[i] != '"') break;

                string key = ReadString(json, ref i, n);
                SkipWs(json, ref i, n);
                if (i >= n || json[i] != ':') break;
                i++;
                SkipWs(json, ref i, n);
                if (i >= n) break;

                string val;
                if (json[i] == '"')
                {
                    val = ReadString(json, ref i, n);
                }
                else if (json[i] == '{' || json[i] == '[')
                {
                    val = SkipNested(json, ref i, n);
                }
                else
                {
                    int start = i;
                    while (i < n && json[i] != ',' && json[i] != '}' && !char.IsWhiteSpace(json[i]))
                    {
                        i++;
                    }
                    val = json.Substring(start, i - start);
                }
                result[key] = val;
            }
            return result;
        }

        private static void SkipWs(string s, ref int i, int n)
        {
            while (i < n && char.IsWhiteSpace(s[i])) i++;
        }

        private static string ReadString(string s, ref int i, int n)
        {
            i++; // skip opening quote
            StringBuilder sb = new StringBuilder();
            while (i < n)
            {
                char c = s[i++];
                if (c == '"') break;
                if (c == '\\' && i < n)
                {
                    char esc = s[i++];
                    switch (esc)
                    {
                        case '"': sb.Append('"'); break;
                        case '\\': sb.Append('\\'); break;
                        case '/': sb.Append('/'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'u':
                            if (i + 4 <= n)
                            {
                                ushort code;
                                if (ushort.TryParse(s.Substring(i, 4), System.Globalization.NumberStyles.HexNumber, null, out code))
                                {
                                    sb.Append((char)code);
                                }
                                i += 4;
                            }
                            break;
                        default: sb.Append(esc); break;
                    }
                }
                else
                {
                    sb.Append(c);
                }
            }
            return sb.ToString();
        }

        private static string SkipNested(string s, ref int i, int n)
        {
            char open = s[i];
            char close = (open == '{') ? '}' : ']';
            int depth = 0;
            int start = i;
            bool inStr = false;
            while (i < n)
            {
                char c = s[i++];
                if (inStr)
                {
                    if (c == '\\') { i++; }
                    else if (c == '"') { inStr = false; }
                }
                else
                {
                    if (c == '"') inStr = true;
                    else if (c == open) depth++;
                    else if (c == close)
                    {
                        depth--;
                        if (depth <= 0) break;
                    }
                }
            }
            return s.Substring(start, i - start);
        }
    }

    internal sealed class LoopbackBridgeServer
    {
        public const int Port = 47831;
        private sealed class ClientConn
        {
            public NetworkStream Stream;
            public readonly object WriteLock = new object();
        }

        private sealed class PendingSaveFile
        {
            public string FileId;
            public string SafeName;
            public string TempPath;
            public string DestDir;
            public FileStream Writer;
            public bool AutoPaste;
        }

        private readonly InputExecutor _executor;
        private TcpListener _listener;
        private volatile bool _running;
        private int _activeClients;
        private readonly object _clientsLock = new object();
        private readonly List<ClientConn> _clients = new List<ClientConn>();
        private Action<Action> _staDispatcher;
        private readonly object _clipLock = new object();
        private readonly Dictionary<string, string> _clipboardFilePaths = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly Dictionary<string, PendingSaveFile> _pendingSaveFiles = new Dictionary<string, PendingSaveFile>(StringComparer.Ordinal);
        private string _lastClipboardSignature = "";
        private string _ignoreNextClipboardText = null;
        private DateTime _ignoreClipboardUntilUtc = DateTime.MinValue;
        private int _clipFileSeq = 0;

        public event Action<string> StatusChanged;

        public int ActiveClients { get { return _activeClients; } }

        public LoopbackBridgeServer(InputExecutor executor)
        {
            _executor = executor;
        }

        public void AttachStaDispatcher(Action<Action> dispatcher)
        {
            _staDispatcher = dispatcher;
        }

        public void Start()
        {
            _listener = new TcpListener(IPAddress.Loopback, Port);
            _listener.Start();
            _running = true;

            Thread acceptThread = new Thread(AcceptLoop);
            acceptThread.IsBackground = true;
            acceptThread.Start();
        }

        public void Stop()
        {
            _running = false;
            try
            {
                if (_listener != null) _listener.Stop();
            }
            catch { }
            lock (_clipLock)
            {
                foreach (KeyValuePair<string, PendingSaveFile> kv in _pendingSaveFiles)
                {
                    try { if (kv.Value.Writer != null) kv.Value.Writer.Dispose(); } catch { }
                    try { if (File.Exists(kv.Value.TempPath)) File.Delete(kv.Value.TempPath); } catch { }
                }
                _pendingSaveFiles.Clear();
            }
            _executor.ReleaseAllHeldInputs();
        }

        private void AcceptLoop()
        {
            while (_running)
            {
                try
                {
                    TcpClient client = _listener.AcceptTcpClient();
                    client.NoDelay = true;
                    Thread t = new Thread(HandleClient);
                    t.IsBackground = true;
                    t.Start(client);
                }
                catch
                {
                    if (!_running) break;
                    Thread.Sleep(50);
                }
            }
        }

        private static bool IsAllowedOrigin(string origin)
        {
            if (string.IsNullOrEmpty(origin)) return false;
            string low = origin.Trim().ToLowerInvariant();
            return low == "https://omnidesk-remote.web.app" ||
                   low == "https://omnidesk-remote.firebaseapp.com" ||
                   low.StartsWith("http://localhost:") ||
                   low == "http://localhost" ||
                   low.StartsWith("https://localhost:") ||
                   low == "https://localhost" ||
                   low.StartsWith("http://127.0.0.1:") ||
                   low == "http://127.0.0.1" ||
                   low.StartsWith("https://127.0.0.1:") ||
                   low == "https://127.0.0.1";
        }

        private void HandleClient(object state)
        {
            TcpClient client = (TcpClient)state;
            bool isWsClient = false;
            try
            {
                using (client)
                using (NetworkStream stream = client.GetStream())
                {
                    string requestText = ReadHttpHeaders(stream);
                    if (string.IsNullOrEmpty(requestText)) return;

                    string[] lines = requestText.Split(new string[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
                    if (lines.Length == 0) return;

                    string requestLine = lines[0];
                    Dictionary<string, string> headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    for (int i = 1; i < lines.Length; i++)
                    {
                        int idx = lines[i].IndexOf(':');
                        if (idx > 0)
                        {
                            string hk = lines[i].Substring(0, idx).Trim();
                            string hv = lines[i].Substring(idx + 1).Trim();
                            headers[hk] = hv;
                        }
                    }

                    string origin;
                    headers.TryGetValue("Origin", out origin);
                    string corsOrigin = IsAllowedOrigin(origin) ? origin : "https://omnidesk-remote.web.app";

                    if (requestLine.StartsWith("OPTIONS ", StringComparison.OrdinalIgnoreCase))
                    {
                        string preflight =
                            "HTTP/1.1 204 No Content\r\n" +
                            "Access-Control-Allow-Origin: " + corsOrigin + "\r\n" +
                            "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n" +
                            "Access-Control-Allow-Headers: Content-Type\r\n" +
                            "Access-Control-Allow-Private-Network: true\r\n" +
                            "Connection: close\r\n\r\n";
                        byte[] buf = Encoding.ASCII.GetBytes(preflight);
                        stream.Write(buf, 0, buf.Length);
                        return;
                    }

                    string upgrade;
                    string wsKey;
                    if (headers.TryGetValue("Upgrade", out upgrade) &&
                        upgrade.IndexOf("websocket", StringComparison.OrdinalIgnoreCase) >= 0 &&
                        headers.TryGetValue("Sec-WebSocket-Key", out wsKey))
                    {
                        if (!string.IsNullOrEmpty(origin) && !IsAllowedOrigin(origin))
                        {
                            byte[] forb = Encoding.ASCII.GetBytes("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
                            stream.Write(forb, 0, forb.Length);
                            return;
                        }

                        string accept = ComputeWebSocketAccept(wsKey);
                        string handshake =
                            "HTTP/1.1 101 Switching Protocols\r\n" +
                            "Upgrade: websocket\r\n" +
                            "Connection: Upgrade\r\n" +
                            "Sec-WebSocket-Accept: " + accept + "\r\n" +
                            "Access-Control-Allow-Private-Network: true\r\n\r\n";
                        byte[] hBytes = Encoding.ASCII.GetBytes(handshake);
                        stream.Write(hBytes, 0, hBytes.Length);

                        ClientConn conn = new ClientConn();
                        conn.Stream = stream;
                        lock (_clientsLock)
                        {
                            _clients.Add(conn);
                        }
                        isWsClient = true;
                        Interlocked.Increment(ref _activeClients);
                        NotifyStatus();
                        SendWsText(conn, "{\"type\":\"hello\",\"version\":2,\"caps\":[\"save-file-start\",\"clipboard-files\",\"release-all\"],\"platform\":\"windows\",\"port\":47831}");

                        try
                        {
                            ProcessWebSocketLoop(conn);
                        }
                        finally
                        {
                            lock (_clientsLock)
                            {
                                _clients.Remove(conn);
                            }
                        }
                    }
                    else
                    {
                        string body = "{\"ok\":true,\"platform\":\"windows\",\"port\":47831,\"active\":true}";
                        string resp =
                            "HTTP/1.1 200 OK\r\n" +
                            "Content-Type: application/json\r\n" +
                            "Access-Control-Allow-Origin: " + corsOrigin + "\r\n" +
                            "Access-Control-Allow-Private-Network: true\r\n" +
                            "Cache-Control: no-store\r\n" +
                            "Content-Length: " + Encoding.UTF8.GetByteCount(body) + "\r\n" +
                            "Connection: close\r\n\r\n" + body;
                        byte[] rBytes = Encoding.UTF8.GetBytes(resp);
                        stream.Write(rBytes, 0, rBytes.Length);
                    }
                }
            }
            catch { }
            finally
            {
                if (isWsClient)
                {
                    Interlocked.Decrement(ref _activeClients);
                    _executor.ReleaseAllHeldInputs();
                    NotifyStatus();
                }
            }
        }

        private void NotifyStatus()
        {
            Action<string> handler = StatusChanged;
            if (handler != null)
            {
                handler(_activeClients > 0 ? "Conectado ao Navegador (" + _activeClients + ")" : "Aguardando Navegador na porta 47831...");
            }
        }

        private void ProcessWebSocketLoop(ClientConn conn)
        {
            NetworkStream stream = conn.Stream;
            MemoryStream fragBuffer = null;
            int fragOpcode = 0;

            while (_running)
            {
                int b1 = stream.ReadByte();
                int b2 = stream.ReadByte();
                if (b1 < 0 || b2 < 0) break;

                bool fin = (b1 & 0x80) != 0;
                int opcode = b1 & 0x0F;
                bool masked = (b2 & 0x80) != 0;
                ulong payloadLen = (ulong)(b2 & 0x7F);

                if (payloadLen == 126)
                {
                    byte[] ext = ReadExact(stream, 2);
                    if (ext == null) break;
                    payloadLen = (ulong)((ext[0] << 8) | ext[1]);
                }
                else if (payloadLen == 127)
                {
                    byte[] ext = ReadExact(stream, 8);
                    if (ext == null) break;
                    payloadLen = ((ulong)ext[0] << 56) | ((ulong)ext[1] << 48) | ((ulong)ext[2] << 40) | ((ulong)ext[3] << 32) |
                                 ((ulong)ext[4] << 24) | ((ulong)ext[5] << 16) | ((ulong)ext[6] << 8) | (ulong)ext[7];
                }

                if (payloadLen > 8388608) break; // 8 MB frame limit

                byte[] maskKey = null;
                if (masked)
                {
                    maskKey = ReadExact(stream, 4);
                    if (maskKey == null) break;
                }

                byte[] payload = ReadExact(stream, (int)payloadLen);
                if (payload == null) break;

                if (masked && maskKey != null)
                {
                    for (int i = 0; i < payload.Length; i++)
                    {
                        payload[i] ^= maskKey[i % 4];
                    }
                }

                if (opcode == 0x8)
                {
                    break; // Close
                }
                else if (opcode == 0x9)
                {
                    SendWsPong(conn, payload);
                }
                else if (opcode == 0xA)
                {
                    // Pong ignored
                }
                else if (opcode == 0x1 || opcode == 0x0)
                {
                    byte[] completePayload = null;
                    int effectiveOpcode = (opcode == 0x0) ? fragOpcode : opcode;
                    if (!fin)
                    {
                        if (opcode == 0x1)
                        {
                            fragOpcode = opcode;
                            if (fragBuffer != null) fragBuffer.Dispose();
                            fragBuffer = new MemoryStream();
                        }
                        if (fragBuffer != null)
                        {
                            fragBuffer.Write(payload, 0, payload.Length);
                            if (fragBuffer.Length > 8388608) break;
                        }
                    }
                    else if (opcode == 0x0)
                    {
                        if (fragBuffer != null)
                        {
                            fragBuffer.Write(payload, 0, payload.Length);
                            completePayload = fragBuffer.ToArray();
                            fragBuffer.Dispose();
                            fragBuffer = null;
                            fragOpcode = 0;
                        }
                    }
                    else
                    {
                        completePayload = payload;
                    }

                    if (completePayload != null && effectiveOpcode == 0x1)
                    {
                        string json = Encoding.UTF8.GetString(completePayload);
                        HandleWsJsonMessage(conn, json);
                    }
                }
            }

            if (fragBuffer != null)
            {
                try { fragBuffer.Dispose(); } catch { }
            }
        }

        private void HandleWsJsonMessage(ClientConn conn, string json)
        {
            Dictionary<string, string> pkt = FlatJsonParser.ParseObject(json);
            string kind;
            if (!pkt.TryGetValue("kind", out kind)) return;

            if (kind == "set-clipboard-text" || kind == "clipboard-set")
            {
                string text;
                if (!pkt.TryGetValue("text", out text)) text = "";
                _ignoreNextClipboardText = text;
                _lastClipboardSignature = "T:" + text;
                RunOnSta(delegate
                {
                    try { Clipboard.SetText(text); } catch { }
                });
                return;
            }

            if (kind == "get-clipboard-files")
            {
                string itemsJson = "";
                string sig = "";
                RunOnStaSync(delegate
                {
                    try
                    {
                        BuildClipboardFilesSnapshot(out itemsJson, out sig);
                    }
                    catch { }
                });
                SendWsText(conn, "{\"kind\":\"clipboard-files-snapshot\",\"files\":[" + itemsJson + "]}");
                return;
            }

            if (kind == "request-clipboard-file")
            {
                string fileId;
                if (!pkt.TryGetValue("id", out fileId) || string.IsNullOrEmpty(fileId)) return;
                string fullPath = null;
                lock (_clipLock)
                {
                    _clipboardFilePaths.TryGetValue(fileId, out fullPath);
                }
                if (string.IsNullOrEmpty(fullPath) || !File.Exists(fullPath))
                {
                    SendWsText(conn, "{\"kind\":\"agent-error\",\"message\":\"Arquivo da área de transferência não encontrado.\"}");
                    return;
                }
                ThreadPool.QueueUserWorkItem(delegate
                {
                    StreamClipboardFileToClient(conn, fileId, fullPath);
                });
                return;
            }

            if (kind == "save-file")
            {
                string fileName;
                string dataB64;
                if (!pkt.TryGetValue("fileName", out fileName) || !pkt.TryGetValue("dataB64", out dataB64)) return;
                string fileId;
                if (!pkt.TryGetValue("fileId", out fileId) || string.IsNullOrEmpty(fileId))
                {
                    fileId = "single-" + Guid.NewGuid().ToString("N");
                }
                string folder;
                pkt.TryGetValue("folder", out folder);
                string autoPasteStr;
                bool autoPaste = pkt.TryGetValue("autoPaste", out autoPasteStr) && autoPasteStr == "true";

                try
                {
                    string destDir = ResolveSaveDestinationDir(folder);
                    string safeName = SanitizeFileName(fileName);
                    string finalPath = GetUniqueDestPath(destDir, safeName);
                    byte[] raw = string.IsNullOrEmpty(dataB64) ? new byte[0] : Convert.FromBase64String(dataB64);
                    File.WriteAllBytes(finalPath, raw);
                    FinalizeSavedFile(conn, fileId, finalPath, autoPaste);
                }
                catch (Exception ex)
                {
                    SendWsText(conn, "{\"kind\":\"agent-error\",\"message\":\"" + EscapeJson("Falha ao salvar arquivo: " + ex.Message) + "\"}");
                }
                return;
            }

            if (kind == "save-file-start")
            {
                string fileId;
                string fileName;
                if (!pkt.TryGetValue("fileId", out fileId) || !pkt.TryGetValue("fileName", out fileName)) return;
                string folder;
                pkt.TryGetValue("folder", out folder);
                string autoPasteStr;
                bool autoPaste = pkt.TryGetValue("autoPaste", out autoPasteStr) && autoPasteStr == "true";

                string destDir = ResolveSaveDestinationDir(folder);

                string safeName = SanitizeFileName(fileName);
                string tempPath = Path.Combine(destDir, ".tmp-" + Guid.NewGuid().ToString("N") + ".part");
                FileStream fs = new FileStream(tempPath, FileMode.Create, FileAccess.Write, FileShare.None);

                PendingSaveFile psf = new PendingSaveFile();
                psf.FileId = fileId;
                psf.SafeName = safeName;
                psf.TempPath = tempPath;
                psf.DestDir = destDir;
                psf.Writer = fs;
                psf.AutoPaste = autoPaste;

                lock (_clipLock)
                {
                    PendingSaveFile old;
                    if (_pendingSaveFiles.TryGetValue(fileId, out old))
                    {
                        try { if (old.Writer != null) old.Writer.Dispose(); } catch { }
                        try { if (File.Exists(old.TempPath)) File.Delete(old.TempPath); } catch { }
                    }
                    _pendingSaveFiles[fileId] = psf;
                }
                return;
            }

            if (kind == "save-file-chunk")
            {
                string fileId;
                string dataB64;
                if (!pkt.TryGetValue("fileId", out fileId) || !pkt.TryGetValue("dataB64", out dataB64)) return;
                PendingSaveFile psf = null;
                lock (_clipLock)
                {
                    _pendingSaveFiles.TryGetValue(fileId, out psf);
                }
                if (psf == null || psf.Writer == null) return;
                if (!string.IsNullOrEmpty(dataB64))
                {
                    byte[] raw = Convert.FromBase64String(dataB64);
                    psf.Writer.Write(raw, 0, raw.Length);
                }
                return;
            }

            if (kind == "save-file-end")
            {
                string fileId;
                if (!pkt.TryGetValue("fileId", out fileId)) return;
                PendingSaveFile psf = null;
                lock (_clipLock)
                {
                    if (_pendingSaveFiles.TryGetValue(fileId, out psf))
                    {
                        _pendingSaveFiles.Remove(fileId);
                    }
                }
                if (psf == null) return;

                string finalPath = GetUniqueDestPath(psf.DestDir, psf.SafeName);
                try
                {
                    psf.Writer.Flush();
                    psf.Writer.Dispose();
                    psf.Writer = null;
                    File.Move(psf.TempPath, finalPath);
                    FinalizeSavedFile(conn, fileId, finalPath, psf.AutoPaste);
                }
                catch
                {
                    try { if (psf.Writer != null) psf.Writer.Dispose(); } catch { }
                    try { if (File.Exists(psf.TempPath)) File.Delete(psf.TempPath); } catch { }
                }
                return;
            }

            _executor.Execute(pkt);
        }

        private static string ResolveSaveDestinationDir(string folder)
        {
            string destDir;
            if (string.Equals(folder, "desktop", StringComparison.OrdinalIgnoreCase))
            {
                destDir = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            }
            else
            {
                string downloadsRoot = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                destDir = Path.Combine(downloadsRoot, "OmniDesk");
            }
            Directory.CreateDirectory(destDir);
            return destDir;
        }

        private void FinalizeSavedFile(ClientConn conn, string fileId, string finalPath, bool autoPaste)
        {
            RunOnStaSync(delegate
            {
                try
                {
                    StringCollection sc = new StringCollection();
                    sc.Add(finalPath);
                    _ignoreClipboardUntilUtc = DateTime.UtcNow.AddSeconds(2);
                    _lastClipboardSignature = "F:" + finalPath.ToLowerInvariant();
                    Clipboard.SetFileDropList(sc);
                }
                catch { }
            });

            if (autoPaste)
            {
                Thread.Sleep(100);
                _executor.TriggerCtrlV();
            }

            SendWsText(
                conn,
                "{\"kind\":\"file-saved\",\"fileId\":\"" + EscapeJson(fileId) +
                "\",\"name\":\"" + EscapeJson(Path.GetFileName(finalPath)) +
                "\",\"path\":\"" + EscapeJson(finalPath) +
                "\",\"autoPaste\":" + (autoPaste ? "true" : "false") + "}"
            );
        }

        private void StreamClipboardFileToClient(ClientConn conn, string fileId, string fullPath)
        {
            try
            {
                FileInfo fi = new FileInfo(fullPath);
                if (!fi.Exists || fi.Length > 157286400) // 150 MB safety cap
                {
                    SendWsText(conn, "{\"kind\":\"agent-error\",\"message\":\"Arquivo excede o limite de 150 MB para sincronização automática.\"}");
                    return;
                }

                const int chunkBytes = 65536;
                int totalChunks = (int)Math.Max(1, (fi.Length + chunkBytes - 1) / chunkBytes);
                SendWsText(
                    conn,
                    "{\"kind\":\"agent-file-start\",\"id\":\"" + EscapeJson(fileId) +
                    "\",\"name\":\"" + EscapeJson(fi.Name) +
                    "\",\"size\":" + fi.Length +
                    ",\"mimeType\":\"application/octet-stream\",\"totalChunks\":" + totalChunks + "}"
                );

                byte[] buf = new byte[chunkBytes];
                int index = 0;
                using (FileStream fs = new FileStream(fullPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                {
                    if (fi.Length == 0)
                    {
                        SendWsText(
                            conn,
                            "{\"kind\":\"agent-file-chunk\",\"id\":\"" + EscapeJson(fileId) +
                            "\",\"index\":0,\"dataB64\":\"\"}"
                        );
                    }
                    else
                    {
                        int read;
                        while ((read = fs.Read(buf, 0, buf.Length)) > 0 && _running)
                        {
                            string b64 = Convert.ToBase64String(buf, 0, read);
                            SendWsText(
                                conn,
                                "{\"kind\":\"agent-file-chunk\",\"id\":\"" + EscapeJson(fileId) +
                                "\",\"index\":" + index + ",\"dataB64\":\"" + b64 + "\"}"
                            );
                            index++;
                        }
                    }
                }

                SendWsText(conn, "{\"kind\":\"agent-file-end\",\"id\":\"" + EscapeJson(fileId) + "\"}");
            }
            catch
            {
                SendWsText(conn, "{\"kind\":\"agent-error\",\"message\":\"Erro ao ler arquivo copiado.\"}");
            }
        }

        private bool BuildClipboardFilesSnapshot(out string itemsJsonOut, out string signatureOut)
        {
            itemsJsonOut = "";
            signatureOut = "";
            if (!Clipboard.ContainsFileDropList()) return false;

            StringCollection dropList = Clipboard.GetFileDropList();
            if (dropList == null || dropList.Count == 0) return false;

            List<string> sigParts = new List<string>();
            StringBuilder itemsJson = new StringBuilder();
            Dictionary<string, string> nextMap = new Dictionary<string, string>(StringComparer.Ordinal);
            int count = 0;

            foreach (string p in dropList)
            {
                if (string.IsNullOrEmpty(p) || !File.Exists(p)) continue;
                FileInfo fi = new FileInfo(p);
                string id = "cf-" + Interlocked.Increment(ref _clipFileSeq);
                nextMap[id] = p;
                sigParts.Add(p.ToLowerInvariant() + ":" + fi.Length + ":" + fi.LastWriteTimeUtc.Ticks);
                if (count > 0) itemsJson.Append(',');
                itemsJson.Append("{\"id\":\"").Append(EscapeJson(id))
                         .Append("\",\"name\":\"").Append(EscapeJson(fi.Name))
                         .Append("\",\"size\":").Append(fi.Length)
                         .Append(",\"mimeType\":\"application/octet-stream\"}");
                count++;
                if (count >= 20) break;
            }

            if (count == 0) return false;

            lock (_clipLock)
            {
                if (_clipboardFilePaths.Count > 80)
                {
                    _clipboardFilePaths.Clear();
                }
                foreach (KeyValuePair<string, string> kv in nextMap)
                {
                    _clipboardFilePaths[kv.Key] = kv.Value;
                }
            }

            itemsJsonOut = itemsJson.ToString();
            signatureOut = "F:" + string.Join("|", sigParts.ToArray());
            return true;
        }

        public void PollClipboard()
        {
            if (!_running || _activeClients <= 0) return;
            if (DateTime.UtcNow < _ignoreClipboardUntilUtc) return;

            try
            {
                if (Clipboard.ContainsFileDropList())
                {
                    string itemsJson;
                    string sig;
                    if (!BuildClipboardFilesSnapshot(out itemsJson, out sig)) return;
                    if (sig == _lastClipboardSignature) return;
                    _lastClipboardSignature = sig;

                    BroadcastJson("{\"kind\":\"clipboard-files\",\"files\":[" + itemsJson + "]}");
                }
                else if (Clipboard.ContainsText())
                {
                    string text = Clipboard.GetText();
                    if (string.IsNullOrEmpty(text)) return;
                    string sig = "T:" + text;
                    if (_ignoreNextClipboardText != null && text == _ignoreNextClipboardText)
                    {
                        _lastClipboardSignature = sig;
                        _ignoreNextClipboardText = null;
                        return;
                    }
                    if (sig == _lastClipboardSignature) return;
                    _lastClipboardSignature = sig;
                    BroadcastJson("{\"kind\":\"clipboard-text\",\"text\":\"" + EscapeJson(text) + "\"}");
                }
            }
            catch
            {
                // Windows clipboard briefly locked by another process; retry on next poll
            }
        }

        private void RunOnSta(Action work)
        {
            Action<Action> dispatcher = _staDispatcher;
            if (dispatcher != null)
            {
                dispatcher(work);
                return;
            }
            Thread t = new Thread(new ThreadStart(work));
            t.SetApartmentState(ApartmentState.STA);
            t.IsBackground = true;
            t.Start();
        }

        private void RunOnStaSync(Action work)
        {
            if (Thread.CurrentThread.GetApartmentState() == ApartmentState.STA)
            {
                work();
                return;
            }
            ManualResetEvent done = new ManualResetEvent(false);
            RunOnSta(delegate
            {
                try { work(); }
                finally { done.Set(); }
            });
            done.WaitOne(1500);
            done.Close();
        }

        private void BroadcastJson(string json)
        {
            ClientConn[] snapshot;
            lock (_clientsLock)
            {
                snapshot = _clients.ToArray();
            }
            for (int i = 0; i < snapshot.Length; i++)
            {
                SendWsText(snapshot[i], json);
            }
        }

        private static string SanitizeFileName(string name)
        {
            string baseName = Path.GetFileName(string.IsNullOrEmpty(name) ? "arquivo.bin" : name);
            if (string.IsNullOrEmpty(baseName)) baseName = "arquivo.bin";
            char[] invalid = Path.GetInvalidFileNameChars();
            StringBuilder sb = new StringBuilder(baseName.Length);
            for (int i = 0; i < baseName.Length; i++)
            {
                char ch = baseName[i];
                bool bad = (ch < 32);
                if (!bad)
                {
                    for (int j = 0; j < invalid.Length; j++)
                    {
                        if (ch == invalid[j]) { bad = true; break; }
                    }
                }
                sb.Append(bad ? '_' : ch);
            }
            string clean = sb.ToString().Trim();
            return string.IsNullOrEmpty(clean) ? "arquivo.bin" : clean;
        }

        private static string GetUniqueDestPath(string dir, string safeName)
        {
            string candidate = Path.Combine(dir, safeName);
            if (!File.Exists(candidate)) return candidate;
            string stem = Path.GetFileNameWithoutExtension(safeName);
            string ext = Path.GetExtension(safeName);
            for (int i = 1; i <= 999; i++)
            {
                string next = Path.Combine(dir, stem + " (" + i + ")" + ext);
                if (!File.Exists(next)) return next;
            }
            return Path.Combine(dir, stem + "-" + Guid.NewGuid().ToString("N").Substring(0, 6) + ext);
        }

        private static string EscapeJson(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            StringBuilder sb = new StringBuilder(s.Length + 16);
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 32)
                        {
                            sb.Append("\\u").Append(((int)c).ToString("X4"));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            return sb.ToString();
        }

        private static string ReadHttpHeaders(NetworkStream stream)
        {
            byte[] buf = new byte[4096];
            int total = 0;
            stream.ReadTimeout = 5000;
            while (total < buf.Length)
            {
                int read = stream.Read(buf, total, buf.Length - total);
                if (read <= 0) break;
                total += read;
                string s = Encoding.ASCII.GetString(buf, 0, total);
                if (s.Contains("\r\n\r\n"))
                {
                    stream.ReadTimeout = Timeout.Infinite;
                    return s;
                }
            }
            stream.ReadTimeout = Timeout.Infinite;
            return total > 0 ? Encoding.ASCII.GetString(buf, 0, total) : "";
        }

        private static byte[] ReadExact(NetworkStream stream, int len)
        {
            byte[] buf = new byte[len];
            int offset = 0;
            while (offset < len)
            {
                int read = stream.Read(buf, offset, len - offset);
                if (read <= 0) return null;
                offset += read;
            }
            return buf;
        }

        private static string ComputeWebSocketAccept(string key)
        {
            string combined = key.Trim() + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
            using (SHA1 sha1 = SHA1.Create())
            {
                byte[] hash = sha1.ComputeHash(Encoding.UTF8.GetBytes(combined));
                return Convert.ToBase64String(hash);
            }
        }

        private static void SendWsText(ClientConn conn, string text)
        {
            byte[] data = Encoding.UTF8.GetBytes(text);
            SendWsFrame(conn, 0x81, data);
        }

        private static void SendWsPong(ClientConn conn, byte[] data)
        {
            SendWsFrame(conn, 0x8A, data);
        }

        private static void SendWsFrame(ClientConn conn, byte firstByte, byte[] data)
        {
            try
            {
                byte[] header;
                int len = data.Length;
                if (len < 126)
                {
                    header = new byte[] { firstByte, (byte)len };
                }
                else if (len <= 65535)
                {
                    header = new byte[] { firstByte, 126, (byte)((len >> 8) & 0xFF), (byte)(len & 0xFF) };
                }
                else
                {
                    ulong ulen = (ulong)len;
                    header = new byte[] {
                        firstByte, 127,
                        (byte)((ulen >> 56) & 0xFF), (byte)((ulen >> 48) & 0xFF),
                        (byte)((ulen >> 40) & 0xFF), (byte)((ulen >> 32) & 0xFF),
                        (byte)((ulen >> 24) & 0xFF), (byte)((ulen >> 16) & 0xFF),
                        (byte)((ulen >> 8) & 0xFF), (byte)(ulen & 0xFF)
                    };
                }
                lock (conn.WriteLock)
                {
                    conn.Stream.Write(header, 0, header.Length);
                    if (len > 0) conn.Stream.Write(data, 0, len);
                }
            }
            catch { }
        }
    }

    internal sealed class AgentForm : Form
    {
        private const string RunRegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValueName = "OmniDeskAgent";
        private const string AgentPrefsRegistryPath = @"Software\OmniDesk\Agent";
        private const string AutoStartConfiguredValueName = "AutoStartConfigured";

        private readonly LoopbackBridgeServer _server;
        private readonly InputExecutor _executor;
        private readonly Label _statusLabel;
        private readonly Label _eventsLabel;
        private readonly CheckBox _autoStartCheck;
        private readonly MenuItem _trayAutoStartItem;
        private readonly NotifyIcon _trayIcon;
        private readonly System.Windows.Forms.Timer _uiTimer;
        private readonly bool _startInTray;
        private bool _syncingAutoStartUi;
        private bool _closing;

        public AgentForm(LoopbackBridgeServer server, InputExecutor executor, bool startInTray)
        {
            _server = server;
            _executor = executor;
            _startInTray = startInTray;

            EnsureAutoStartConfiguredOnFirstRun();

            _server.AttachStaDispatcher(delegate(Action work)
            {
                if (!_closing && !IsDisposed && IsHandleCreated)
                {
                    try { BeginInvoke(work); } catch { }
                }
            });

            Text = "OmniDesk Agente Windows — Controle Nativo";
            Width = 450;
            Height = 235;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(15, 23, 42);
            ForeColor = Color.White;

            Label title = new Label();
            title.Text = "OmniDesk Agente Windows Ativo";
            title.Font = new Font("Segoe UI", 12, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(34, 211, 238);
            title.SetBounds(20, 18, 400, 26);
            Controls.Add(title);

            _statusLabel = new Label();
            _statusLabel.Text = "Aguardando navegador OmniDesk em 127.0.0.1:47831...";
            _statusLabel.Font = new Font("Segoe UI", 9, FontStyle.Regular);
            _statusLabel.ForeColor = Color.FromArgb(203, 213, 225);
            _statusLabel.SetBounds(20, 50, 400, 22);
            Controls.Add(_statusLabel);

            _eventsLabel = new Label();
            _eventsLabel.Text = "Comandos executados nesta sessão: 0";
            _eventsLabel.Font = new Font("Segoe UI", 9, FontStyle.Regular);
            _eventsLabel.ForeColor = Color.FromArgb(148, 163, 184);
            _eventsLabel.SetBounds(20, 74, 400, 22);
            Controls.Add(_eventsLabel);

            _autoStartCheck = new CheckBox();
            _autoStartCheck.Text = "Iniciar automaticamente com o Windows (bandeja)";
            _autoStartCheck.Font = new Font("Segoe UI", 9, FontStyle.Regular);
            _autoStartCheck.ForeColor = Color.FromArgb(226, 232, 240);
            _autoStartCheck.SetBounds(20, 106, 400, 24);
            _autoStartCheck.CheckedChanged += delegate
            {
                if (!_syncingAutoStartUi)
                {
                    ToggleAutoStart(_autoStartCheck.Checked);
                }
            };
            Controls.Add(_autoStartCheck);

            Button minimizeBtn = new Button();
            minimizeBtn.Text = "Ocultar na Bandeja";
            minimizeBtn.BackColor = Color.FromArgb(30, 41, 59);
            minimizeBtn.ForeColor = Color.White;
            minimizeBtn.FlatStyle = FlatStyle.Flat;
            minimizeBtn.SetBounds(20, 144, 155, 34);
            minimizeBtn.Click += delegate { HideToTray(); };
            Controls.Add(minimizeBtn);

            Button stopBtn = new Button();
            stopBtn.Text = "Encerrar Agente";
            stopBtn.BackColor = Color.FromArgb(225, 29, 72);
            stopBtn.ForeColor = Color.White;
            stopBtn.FlatStyle = FlatStyle.Flat;
            stopBtn.SetBounds(265, 144, 155, 34);
            stopBtn.Click += delegate { Close(); };
            Controls.Add(stopBtn);

            _trayAutoStartItem = new MenuItem();
            _trayAutoStartItem.Click += delegate { ToggleAutoStart(!IsAutoStartEnabled()); };

            ContextMenu trayMenu = new ContextMenu();
            trayMenu.MenuItems.Add("Abrir Painel OmniDesk", delegate { ShowFromTray(); });
            trayMenu.MenuItems.Add(_trayAutoStartItem);
            trayMenu.MenuItems.Add("Encerrar Agente", delegate { Close(); });

            SyncAutoStartUi(IsAutoStartEnabled());

            _trayIcon = new NotifyIcon();
            _trayIcon.Icon = SystemIcons.Application;
            _trayIcon.Text = "OmniDesk Agente Windows (Porta 47831)";
            _trayIcon.ContextMenu = trayMenu;
            _trayIcon.Visible = true;
            _trayIcon.DoubleClick += delegate { ShowFromTray(); };

            _server.StatusChanged += delegate(string text)
            {
                if (!_closing && !IsDisposed && IsHandleCreated)
                {
                    BeginInvoke((MethodInvoker)delegate { _statusLabel.Text = text; });
                }
            };

            _uiTimer = new System.Windows.Forms.Timer();
            _uiTimer.Interval = 500;
            _uiTimer.Tick += delegate
            {
                _eventsLabel.Text = "Comandos de mouse/teclado executados: " + _executor.EventsExecuted;
                _server.PollClipboard();
            };
            _uiTimer.Start();

            Resize += delegate
            {
                if (WindowState == FormWindowState.Minimized)
                {
                    ShowInTaskbar = false;
                    Hide();
                }
            };

            Load += delegate
            {
                if (_startInTray)
                {
                    BeginInvoke((MethodInvoker)delegate { HideToTray(); });
                }
            };

            FormClosing += delegate
            {
                _closing = true;
                _uiTimer.Stop();
                _trayIcon.Visible = false;
                _trayIcon.Dispose();
                _server.Stop();
            };
        }

        private void HideToTray()
        {
            ShowInTaskbar = false;
            WindowState = FormWindowState.Minimized;
            Hide();
        }

        private void ShowFromTray()
        {
            ShowInTaskbar = true;
            Show();
            WindowState = FormWindowState.Normal;
            Activate();
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            try { NativeWin32.AddClipboardFormatListener(Handle); } catch { }
        }

        protected override void OnHandleDestroyed(EventArgs e)
        {
            try { NativeWin32.RemoveClipboardFormatListener(Handle); } catch { }
            base.OnHandleDestroyed(e);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == NativeWin32.WM_CLIPBOARDUPDATE && _server != null)
            {
                _server.PollClipboard();
            }
            base.WndProc(ref m);
        }

        private void ToggleAutoStart(bool enable)
        {
            SetAutoStartEnabled(enable);
            SyncAutoStartUi(IsAutoStartEnabled());
        }

        private void SyncAutoStartUi(bool enabled)
        {
            _syncingAutoStartUi = true;
            try
            {
                if (_autoStartCheck != null)
                {
                    _autoStartCheck.Checked = enabled;
                }
                if (_trayAutoStartItem != null)
                {
                    _trayAutoStartItem.Checked = enabled;
                    _trayAutoStartItem.Text = enabled
                        ? "Iniciar automaticamente com o Windows (Ativado)"
                        : "Iniciar automaticamente com o Windows (Desativado)";
                }
            }
            finally
            {
                _syncingAutoStartUi = false;
            }
        }

        private static void EnsureAutoStartConfiguredOnFirstRun()
        {
            try
            {
                using (RegistryKey prefs = Registry.CurrentUser.OpenSubKey(AgentPrefsRegistryPath, false))
                {
                    if (prefs != null && prefs.GetValue(AutoStartConfiguredValueName) != null)
                    {
                        return;
                    }
                }

                SetAutoStartEnabled(true);
                using (RegistryKey writePrefs = Registry.CurrentUser.CreateSubKey(AgentPrefsRegistryPath))
                {
                    if (writePrefs != null)
                    {
                        writePrefs.SetValue(AutoStartConfiguredValueName, 1, RegistryValueKind.DWord);
                    }
                }
            }
            catch { }
        }

        private static bool IsAutoStartEnabled()
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunRegistryPath, false))
                {
                    if (key == null) return false;
                    object val = key.GetValue(RunValueName);
                    return val != null && !string.IsNullOrEmpty(val.ToString());
                }
            }
            catch
            {
                return false;
            }
        }

        private static bool SetAutoStartEnabled(bool enable)
        {
            try
            {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(RunRegistryPath, true) ??
                                         Registry.CurrentUser.CreateSubKey(RunRegistryPath))
                {
                    if (key == null) return false;
                    if (enable)
                    {
                        key.SetValue(RunValueName, "\"" + Application.ExecutablePath + "\" --tray");
                    }
                    else
                    {
                        key.DeleteValue(RunValueName, false);
                    }
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }
    }

    internal static class Program
    {
        private static Mutex _singleInstanceMutex;

        [STAThread]
        private static void Main(string[] args)
        {
            bool startInTray = false;
            if (args != null)
            {
                for (int i = 0; i < args.Length; i++)
                {
                    if (string.Equals(args[i], "--tray", StringComparison.OrdinalIgnoreCase))
                    {
                        startInTray = true;
                    }
                }
            }

            bool createdNew;
            _singleInstanceMutex = new Mutex(true, "OmniDesk_Windows_Native_Agent_47831", out createdNew);
            if (!createdNew)
            {
                return;
            }

            try
            {
                NativeWin32.SetProcessDPIAware();
            }
            catch { }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            InputExecutor executor = new InputExecutor();
            LoopbackBridgeServer server = new LoopbackBridgeServer(executor);
            try
            {
                server.Start();
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Não foi possível iniciar o Agente OmniDesk na porta 47831:\n" + ex.Message,
                    "OmniDesk Agente Windows",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            Application.Run(new AgentForm(server, executor, startInTray));
            GC.KeepAlive(_singleInstanceMutex);
        }
    }
}
