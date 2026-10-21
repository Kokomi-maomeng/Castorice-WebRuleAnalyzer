package main

import (
	"flag"
	"fmt"
	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/testsite"
	"net/http"
)

func main() {
	address := flag.String("listen", "127.0.0.1:19111", "仅限本地测试站地址")
	mapped := flag.Bool("mapped-hosts", false, "生成 scan.test / assets.scan.test / api.scan.test 的测试资源 URL")
	flag.Parse()
	fmt.Println("本地测试站 http://" + *address)
	if err := http.ListenAndServe(*address, testsite.Handler(*mapped)); err != nil {
		panic(err)
	}
}
