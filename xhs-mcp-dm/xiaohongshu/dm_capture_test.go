package xiaohongshu

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/launcher"
)

func TestCaptureLocal(t *testing.T) {
	bin := os.Getenv("CHROME_BIN")
	if bin == "" {
		t.Skip("no CHROME_BIN")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/im/web/v3/chats" {
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"data":{"chats":[{"chat_user_id":"u1","info":{"nickname":"小兔"}}]}}`)
			return
		}
		fmt.Fprint(w, `<html><body>hi<script>alert('请在App中查看');setTimeout(()=>fetch('/api/im/web/v3/chats'),500)</script></body></html>`)
	}))
	defer srv.Close()
	u := launcher.New().Bin(bin).Headless(true).Set("no-sandbox").MustLaunch()
	b := rod.New().ControlURL(u).MustConnect()
	defer b.MustClose()
	page := b.MustPage("")
	c := startCapture(page)
	page.MustNavigate(srv.URL + "/im")
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		if _, body := c.find("/chats"); body != "" {
			t.Logf("got %s; seen %s", body, c.seen())
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("nothing captured; seen=%q", c.seen())
}
