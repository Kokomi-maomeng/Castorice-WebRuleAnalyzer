package storage

import "errors"

var ErrDataInUse = errors.New("数据目录已被其他实例占用，请先关闭原实例或指定另一个目录")
