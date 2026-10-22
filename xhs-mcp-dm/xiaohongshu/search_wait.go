package xiaohongshu

// xhs-mcp-dm 的补丁：搜索结果页一直在加载图片、跑动画，整页永远等不到「稳定」，
// 原来的 MustWaitStable 每次都卡满 60 秒超时（上游 issue #813 #836 #874）。
// 改成只等搜索结果本身到位。

import (
	"time"

	"github.com/go-rod/rod"
)

// waitFeedsReady 等到搜索结果列表里有东西，最多等 timeout。
func waitFeedsReady(page *rod.Page, timeout time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if readFeedIDs(page) != "" {
			return true
		}
		time.Sleep(400 * time.Millisecond)
	}
	return false
}
