using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Windows.Forms;

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

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);
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

        private static void SendMouseMove(double x, double y)
        {
            int screenW = Math.Max(1, NativeWin32.GetSystemMetrics(0));
            int screenH = Math.Max(1, NativeWin32.GetSystemMetrics(1));
            int px = (int)Math.Round(x * (screenW - 1));
            int py = (int)Math.Round(y * (screenH - 1));
            NativeWin32.SetCursorPos(px, py);

            int absX = (int)Math.Round(x * 65535.0);
            int absY = (int)Math.Round(y * 65535.0);

            NativeWin32.INPUT[] inputs = new NativeWin32.INPUT[1];
            inputs[0].type = NativeWin32.INPUT_MOUSE;
            inputs[0].U.mi.dx = absX;
            inputs[0].U.mi.dy = absY;
            inputs[0].U.mi.dwFlags = NativeWin32.MOUSEEVENTF_MOVE | NativeWin32.MOUSEEVENTF_ABSOLUTE;
            NativeWin32.SendInput(1, inputs, NativeWin32.INPUT.Size);
        }

        private static void SendMouseButton(double x, double y, string button, bool isDown)
        {
            SendMouseMove(x, y);

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
        private readonly InputExecutor _executor;
        private TcpListener _listener;
        private volatile bool _running;
        private int _activeClients;
        public event Action<string> StatusChanged;

        public int ActiveClients { get { return _activeClients; } }

        public LoopbackBridgeServer(InputExecutor executor)
        {
            _executor = executor;
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

                        isWsClient = true;
                        Interlocked.Increment(ref _activeClients);
                        NotifyStatus();
                        SendWsText(stream, "{\"type\":\"hello\",\"platform\":\"windows\",\"port\":47831}");

                        ProcessWebSocketLoop(stream);
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

        private void ProcessWebSocketLoop(NetworkStream stream)
        {
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

                if (payloadLen > 1048576) break;

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
                    SendWsPong(stream, payload);
                }
                else if (opcode == 0x1 && fin)
                {
                    string json = Encoding.UTF8.GetString(payload);
                    Dictionary<string, string> pkt = FlatJsonParser.ParseObject(json);
                    _executor.Execute(pkt);
                }
            }
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

        private static void SendWsText(NetworkStream stream, string text)
        {
            byte[] data = Encoding.UTF8.GetBytes(text);
            SendWsFrame(stream, 0x81, data);
        }

        private static void SendWsPong(NetworkStream stream, byte[] data)
        {
            SendWsFrame(stream, 0x8A, data);
        }

        private static void SendWsFrame(NetworkStream stream, byte firstByte, byte[] data)
        {
            try
            {
                byte[] header;
                if (data.Length < 126)
                {
                    header = new byte[] { firstByte, (byte)data.Length };
                }
                else
                {
                    header = new byte[] { firstByte, 126, (byte)((data.Length >> 8) & 0xFF), (byte)(data.Length & 0xFF) };
                }
                stream.Write(header, 0, header.Length);
                if (data.Length > 0) stream.Write(data, 0, data.Length);
            }
            catch { }
        }
    }

    internal sealed class AgentForm : Form
    {
        private readonly LoopbackBridgeServer _server;
        private readonly InputExecutor _executor;
        private readonly Label _statusLabel;
        private readonly Label _eventsLabel;
        private readonly System.Windows.Forms.Timer _uiTimer;

        public AgentForm(LoopbackBridgeServer server, InputExecutor executor)
        {
            _server = server;
            _executor = executor;

            Text = "OmniDesk Agente Windows — Controle Nativo";
            Width = 430;
            Height = 200;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(15, 23, 42);
            ForeColor = Color.White;

            Label title = new Label();
            title.Text = "OmniDesk Agente Windows Ativo";
            title.Font = new Font("Segoe UI", 12, FontStyle.Bold);
            title.ForeColor = Color.FromArgb(34, 211, 238);
            title.SetBounds(20, 18, 380, 26);
            Controls.Add(title);

            _statusLabel = new Label();
            _statusLabel.Text = "Aguardando navegador OmniDesk em 127.0.0.1:47831...";
            _statusLabel.Font = new Font("Segoe UI", 9, FontStyle.Regular);
            _statusLabel.ForeColor = Color.FromArgb(203, 213, 225);
            _statusLabel.SetBounds(20, 52, 380, 22);
            Controls.Add(_statusLabel);

            _eventsLabel = new Label();
            _eventsLabel.Text = "Comandos executados nesta sessão: 0";
            _eventsLabel.Font = new Font("Segoe UI", 9, FontStyle.Regular);
            _eventsLabel.ForeColor = Color.FromArgb(148, 163, 184);
            _eventsLabel.SetBounds(20, 78, 380, 22);
            Controls.Add(_eventsLabel);

            Button minimizeBtn = new Button();
            minimizeBtn.Text = "Minimizar";
            minimizeBtn.BackColor = Color.FromArgb(30, 41, 59);
            minimizeBtn.ForeColor = Color.White;
            minimizeBtn.FlatStyle = FlatStyle.Flat;
            minimizeBtn.SetBounds(20, 114, 120, 32);
            minimizeBtn.Click += delegate { WindowState = FormWindowState.Minimized; };
            Controls.Add(minimizeBtn);

            Button stopBtn = new Button();
            stopBtn.Text = "Encerrar Agente";
            stopBtn.BackColor = Color.FromArgb(225, 29, 72);
            stopBtn.ForeColor = Color.White;
            stopBtn.FlatStyle = FlatStyle.Flat;
            stopBtn.SetBounds(250, 114, 150, 32);
            stopBtn.Click += delegate { Close(); };
            Controls.Add(stopBtn);

            _server.StatusChanged += delegate(string text)
            {
                if (!IsDisposed && IsHandleCreated)
                {
                    BeginInvoke((MethodInvoker)delegate { _statusLabel.Text = text; });
                }
            };

            _uiTimer = new System.Windows.Forms.Timer();
            _uiTimer.Interval = 500;
            _uiTimer.Tick += delegate
            {
                _eventsLabel.Text = "Comandos de mouse/teclado executados: " + _executor.EventsExecuted;
            };
            _uiTimer.Start();

            FormClosing += delegate
            {
                _uiTimer.Stop();
                _server.Stop();
            };
        }
    }

    internal static class Program
    {
        private static Mutex _singleInstanceMutex;

        [STAThread]
        private static void Main()
        {
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

            Application.Run(new AgentForm(server, executor));
            GC.KeepAlive(_singleInstanceMutex);
        }
    }
}
