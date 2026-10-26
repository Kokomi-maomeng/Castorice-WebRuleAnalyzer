package scanner

import (
	"errors"
	"os"
	"time"
)

// Chrome children may finish asynchronous writes just after the main process
// exits. Require an absent, quiet period, instead of returning on the first
// successful RemoveAll (which also succeeds when late writers recreate it).
func removeProfile(profile string) error {
	deadline := time.Now().Add(3 * time.Second)
	quietSince := time.Now()
	for {
		_, err := os.Stat(profile)
		if !errors.Is(err, os.ErrNotExist) {
			quietSince = time.Now()
		}
		if err = os.RemoveAll(profile); err != nil {
			quietSince = time.Now()
		}
		if time.Since(quietSince) >= 250*time.Millisecond {
			if _, e := os.Stat(profile); errors.Is(e, os.ErrNotExist) {
				return nil
			}
		}
		if time.Now().After(deadline) {
			if err != nil {
				return err
			}
			return errors.New("浏览器 Profile 仍在写入，未完成清理")
		}
		time.Sleep(25 * time.Millisecond)
	}
}
