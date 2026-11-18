package main

import (
	"flag"
	"fmt"
	"net"
	"net/http"

	"github.com/castorice/Castorice-WebRuleAnalyzer/backend/internal/testsite"
)

func main() {
	address := flag.String("listen", "127.0.0.1:19111", "仅限本地测试站地址")
	mapped := flag.Bool("mapped-hosts", false, "生成 scan.test / assets.scan.test / api.scan.test 的测试资源 URL")
	flag.Parse()
	listener, err := net.Listen("tcp", *address)
	if err != nil {
		panic(err)
	}
	fmt.Println("本地测试站 http://" + listener.Addr().String())
	if err := http.Serve(listener, testsite.Handler(*mapped)); err != nil {
		panic(err)
	}
}
