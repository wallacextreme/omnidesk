#include <windows.h>

typedef ULONG (WINAPI *PFN_EventSetInformation)(
    ULONGLONG RegHandle,
    ULONG InformationClass,
    PVOID EventInformation,
    ULONG InformationLength
);

static ULONG WINAPI Win7SafeEventSetInformation(
    ULONGLONG RegHandle,
    ULONG InformationClass,
    PVOID EventInformation,
    ULONG InformationLength
) {
    HMODULE hAdvapi = GetModuleHandleA("advapi32.dll");
    if (hAdvapi != NULL) {
        PFN_EventSetInformation pfn =
            (PFN_EventSetInformation)(void *)GetProcAddress(hAdvapi, "EventSetInformation");
        if (pfn != NULL) {
            return pfn(RegHandle, InformationClass, EventInformation, InformationLength);
        }
    }
    return 0; /* ERROR_SUCCESS when unavailable on unpatched Windows 7 */
}

/* Provides the __imp_EventSetInformation IAT slot expected by WebView2LoaderStatic.lib
   so ADVAPI32!EventSetInformation is resolved dynamically at runtime via GetProcAddress
   instead of failing DLL load on Windows 7 SP1. */
const void *__imp_EventSetInformation = (const void *)&Win7SafeEventSetInformation;
