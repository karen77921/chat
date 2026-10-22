"""把 search.go 里「等整页稳定」换成「等搜索结果到位」。已经换过就什么都不做；对不上就报错退出。"""
import sys
from pathlib import Path

path = Path(sys.argv[1])
src = path.read_text(encoding="utf-8")
old = """	page.MustNavigate(searchURL)
	page.MustWaitStable()
	page.MustWait(`() => window.__INITIAL_STATE__ !== undefined`)
"""
new = """	// xhs-mcp-dm：不等整页稳定（搜索页永远等不到），只等搜索结果到位
	if err := page.Timeout(20 * time.Second).Navigate(searchURL); err != nil {
		logrus.Infof("搜索页还在加载（%v），接着等结果", err)
	}
	if !waitFeedsReady(page, 25*time.Second) {
		return nil, fmt.Errorf("搜索页 25 秒内没等到结果：可能没登录、被风控，或者这个词没有结果")
	}
"""
if "waitFeedsReady(page" in src:
    sys.exit(0)
if old not in src:
    sys.exit("search.go 和预想的不一样（上游改过了），搜索补丁没打上")
path.write_text(src.replace(old, new, 1), encoding="utf-8")
