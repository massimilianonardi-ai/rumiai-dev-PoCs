/*
 * PoC 062 only: observable POSIX advisory record locks and FIFO activity tokens.
 * Compiled by its Node experiment, not a shipped command or product facility.
 */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

static void die(const char *what) {
    fprintf(stderr, "probe %s: %s\n", what, strerror(errno));
    exit(74);
}
static void message(const char *s) {
    puts(s);
    fflush(stdout);
}
static void hold(void) {
    for (;;) pause();
}
static int lock_record(int fd) {
    struct flock fl;
    memset(&fl, 0, sizeof fl);
    fl.l_type = F_WRLCK;
    fl.l_whence = SEEK_SET;
    fl.l_start = 0;
    fl.l_len = 0;
    return fcntl(fd, F_SETLK, &fl);
}
int main(int argc, char **argv) {
    int fd;
    if (argc == 2 && strcmp(argv[1], "exec-child") == 0) {
        message("EXECED");
        hold();
    }
    if (argc < 3) {
        fputs("usage: probe MODE PATH\n", stderr);
        return 64;
    }
    const char *mode=argv[1], *path=argv[2];
    if (strncmp(mode,"fifo-",5)==0) {
        if (strcmp(mode,"fifo-owner")==0) {
            if (mkfifo(path,0600)!=0 && errno!=EEXIST) die("mkfifo");
            fd=open(path,O_RDONLY|O_NONBLOCK);
            if (fd<0) die("open fifo reader");
            message("READY"); hold();
        }
        if (strcmp(mode,"fifo-probe")==0) {
            fd=open(path,O_WRONLY|O_NONBLOCK);
            if (fd>=0) { message("ACTIVE"); close(fd); return 0; }
            if (errno==ENXIO) { message("STALE"); return 0; }
            die("probe fifo");
        }
        return 64;
    }
    fd=open(path,O_RDWR|O_CREAT,0600);
    if (fd<0) die("open");
    if (lock_record(fd)<0) {
        if (errno==EACCES||errno==EAGAIN) {
            message("BUSY");
            close(fd);
            return 73;
        }
        die("fcntl lock");
    }
    if (strcmp(mode,"probe")==0) { message("FREE"); close(fd); return 0; }
    if (strcmp(mode,"hold")==0) { message("READY"); hold(); }
    if (strcmp(mode,"close-another")==0) {
        int second=open(path,O_RDONLY);
        if (second<0) die("second open");
        close(second);  /* POSIX record locks on file are released by *any* close. */
        message("CLOSED_OTHER");
        hold();
    }
    if (strcmp(mode,"fork-exit")==0) {
        pid_t pid=fork();
        if(pid<0) die("fork");
        if(pid==0) { message("FORK_CHILD"); hold(); }
        printf("FORKED %ld\n",(long)pid); fflush(stdout);
        close(fd);
        return 0;
    }
    if (strcmp(mode,"exec-retain")==0||strcmp(mode,"exec-cloexec")==0) {
        if (strcmp(mode,"exec-cloexec")==0) {
            if(fcntl(fd,F_SETFD,FD_CLOEXEC)<0) die("set cloexec");
        }
        message("EXEC_START");
        execl(argv[0],argv[0],"exec-child",(char*)0);
        die("exec self");
    }
    if (strcmp(mode,"unlink-hold")==0) {
        if(unlink(path)<0) die("unlink");
        message("UNLINKED");
        hold();
    }
    fprintf(stderr,"unknown mode: %s\n",mode);
    return 64;
}
