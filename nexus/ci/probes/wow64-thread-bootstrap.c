/* SPDX-License-Identifier: MIT
 * Account-free thread bootstrap reproducer. No game or Xbox API calls. */
#define _WIN32_WINNT 0x0601
#include <windows.h>
#include <stdio.h>
#include <string.h>
struct state { LONG entered, finished; DWORD tid; };
static DWORD WINAPI worker(void *arg)
{
    struct state *state = arg;
    state->tid = GetCurrentThreadId();
    InterlockedIncrement(&state->entered);
    InterlockedIncrement(&state->finished);
    return 0;
}
int main(int argc, char **argv)
{
    if (argc > 1 && !strcmp(argv[1], "--load-runtime") && !LoadLibraryA("xgameruntime.dll")) {
        printf("LOAD ERROR %lu\n", GetLastError());
        return 2;
    }
    for (unsigned batch = 0; batch < 64; batch++) {
        struct state states[8] = {{0}};
        HANDLE threads[8] = {0};
        for (unsigned i = 0; i < 8; i++) {
            threads[i] = CreateThread(NULL, 0, worker, &states[i], 0, NULL);
            if (!threads[i]) { printf("CREATE ERROR %lu\n", GetLastError()); ExitProcess(2); }
        }
        DWORD waited = WaitForMultipleObjects(8, threads, TRUE, 15000);
        if (waited != WAIT_OBJECT_0) {
            printf("JOIN batch=%u result=%lx error=%lu\n", batch, waited, GetLastError());
            for (unsigned i = 0; i < 8; i++) {
                DWORD code = ~0u;
                BOOL queried = GetExitCodeThread(threads[i], &code);
                printf("THREAD index=%u id=%lu entered=%ld finished=%ld queried=%d exit=%lx\n",
                       i, GetThreadId(threads[i]), states[i].entered, states[i].finished, queried, code);
            }
            fflush(stdout);
            /* State belongs to this process. Do not return across live workers. */
            ExitProcess(1);
        }
        for (unsigned i = 0; i < 8; i++) {
            DWORD code;
            if (!GetExitCodeThread(threads[i], &code) || code || states[i].entered != 1 || states[i].finished != 1)
                ExitProcess(3);
            CloseHandle(threads[i]);
        }
    }
    puts("THREAD BOOTSTRAP 512/512 PASS");
    return 0;
}
