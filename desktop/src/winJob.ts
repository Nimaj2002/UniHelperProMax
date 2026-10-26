// Windows job object: the backend is assigned to a job that is killed when its last handle
// closes. This process holds the only handle, so when the app exits or crashes Windows kills
// the backend with it (research R5). Also: the executable path of a PID, to recognise a stale
// backend (research R6). Everything here is a no-op on macOS and Linux.
/* eslint-disable @typescript-eslint/no-explicit-any */

const JobObjectExtendedLimitInformation = 9;
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_SET_QUOTA = 0x0100;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

interface Win32 {
  koffi: any;
  CreateJobObjectW: (attrs: null, name: null) => unknown;
  SetInformationJobObject: (job: unknown, cls: number, info: unknown, size: number) => boolean;
  OpenProcess: (access: number, inherit: boolean, pid: number) => unknown;
  AssignProcessToJobObject: (job: unknown, proc: unknown) => boolean;
  CloseHandle: (handle: unknown) => boolean;
  QueryFullProcessImageNameW: (proc: unknown, flags: number, buf: Buffer, size: number[]) => boolean;
  ExtendedLimit: any;
}

let api: Win32 | null = null;

function win32(): Win32 {
  if (api) return api;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require("koffi");
  const kernel32 = koffi.load("kernel32.dll");
  koffi.pointer("HANDLE", koffi.opaque());
  const Basic = koffi.struct("JOBOBJECT_BASIC_LIMIT_INFORMATION", {
    PerProcessUserTimeLimit: "int64_t",
    PerJobUserTimeLimit: "int64_t",
    LimitFlags: "uint32_t",
    MinimumWorkingSetSize: "size_t",
    MaximumWorkingSetSize: "size_t",
    ActiveProcessLimit: "uint32_t",
    Affinity: "uintptr_t",
    PriorityClass: "uint32_t",
    SchedulingClass: "uint32_t",
  });
  const IoCounters = koffi.struct("IO_COUNTERS", {
    ReadOperationCount: "uint64_t",
    WriteOperationCount: "uint64_t",
    OtherOperationCount: "uint64_t",
    ReadTransferCount: "uint64_t",
    WriteTransferCount: "uint64_t",
    OtherTransferCount: "uint64_t",
  });
  const ExtendedLimit = koffi.struct("JOBOBJECT_EXTENDED_LIMIT_INFORMATION", {
    BasicLimitInformation: Basic,
    IoInfo: IoCounters,
    ProcessMemoryLimit: "size_t",
    JobMemoryLimit: "size_t",
    PeakProcessMemoryUsed: "size_t",
    PeakJobMemoryUsed: "size_t",
  });
  api = {
    koffi,
    ExtendedLimit,
    CreateJobObjectW: kernel32.func("HANDLE __stdcall CreateJobObjectW(void *attrs, const char16_t *name)"),
    SetInformationJobObject: kernel32.func(
      "bool __stdcall SetInformationJobObject(HANDLE job, int cls, JOBOBJECT_EXTENDED_LIMIT_INFORMATION *info, uint32_t size)",
    ),
    OpenProcess: kernel32.func("HANDLE __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)"),
    AssignProcessToJobObject: kernel32.func("bool __stdcall AssignProcessToJobObject(HANDLE job, HANDLE proc)"),
    CloseHandle: kernel32.func("bool __stdcall CloseHandle(HANDLE h)"),
    QueryFullProcessImageNameW: kernel32.func(
      "bool __stdcall QueryFullProcessImageNameW(HANDLE proc, uint32_t flags, _Out_ uint8_t *buf, _Inout_ uint32_t *size)",
    ),
  };
  return api;
}

let job: unknown = null; // held for the life of this process on purpose

/** Create the kill-on-close job once; false when it could not be created (logged by caller). */
export function ensureJob(): boolean {
  if (process.platform !== "win32") return false;
  if (job) return true;
  const w = win32();
  const handle = w.CreateJobObjectW(null, null);
  if (!handle) return false;
  const info = {
    BasicLimitInformation: {
      PerProcessUserTimeLimit: 0,
      PerJobUserTimeLimit: 0,
      LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
      MinimumWorkingSetSize: 0,
      MaximumWorkingSetSize: 0,
      ActiveProcessLimit: 0,
      Affinity: 0,
      PriorityClass: 0,
      SchedulingClass: 0,
    },
    IoInfo: {
      ReadOperationCount: 0,
      WriteOperationCount: 0,
      OtherOperationCount: 0,
      ReadTransferCount: 0,
      WriteTransferCount: 0,
      OtherTransferCount: 0,
    },
    ProcessMemoryLimit: 0,
    JobMemoryLimit: 0,
    PeakProcessMemoryUsed: 0,
    PeakJobMemoryUsed: 0,
  };
  if (!w.SetInformationJobObject(handle, JobObjectExtendedLimitInformation, info, w.koffi.sizeof(w.ExtendedLimit))) {
    w.CloseHandle(handle);
    return false;
  }
  job = handle;
  return true;
}

/** Put `pid` in the job; returns false (caller logs) if Windows refused. */
export function assign(pid: number): boolean {
  if (process.platform !== "win32" || !ensureJob()) return false;
  const w = win32();
  const proc = w.OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid);
  if (!proc) return false;
  try {
    return w.AssignProcessToJobObject(job, proc);
  } finally {
    w.CloseHandle(proc);
  }
}

/** Full executable path of a running process, or null. */
export function imagePath(pid: number): string | null {
  if (process.platform !== "win32") return null;
  const w = win32();
  const proc = w.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!proc) return null;
  try {
    const chars = [32768];
    const buf = Buffer.alloc(chars[0] * 2);
    if (!w.QueryFullProcessImageNameW(proc, 0, buf, chars)) return null;
    return buf.toString("utf16le", 0, chars[0] * 2);
  } finally {
    w.CloseHandle(proc);
  }
}
