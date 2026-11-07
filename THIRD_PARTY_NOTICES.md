# 第三方资料与依赖

根目录的 MPL 2.0 适用于本项目原创代码。下列术语数据保留各自的来源和授权，不能仅根据根目录许可证判断其使用条件。

## 术语数据

`extension/terms/learning.json`、`programming.json`、`business.json`、`investing.json` 中标记为 `ogdi-tw-1.0` 的部分，来自下列台湾政府开放资料。项目对词条进行了筛选、清理和简体中文转换；数据仍按[政府資料開放授權條款第 1 版](https://data.gov.tw/license)使用，并在此标示提供机关与原资料集。

| 提供机关与上架年份 | 原资料集 | 项目内数据集编号 |
| --- | --- | --- |
| 國家教育研究院，2015 | [教育學學術名詞](https://data.gov.tw/dataset/15367) | 15367 |
| 國家教育研究院，2015 | [兩岸對照名詞－計算機學術名詞](https://data.gov.tw/dataset/15275) | 15275 |
| 國家教育研究院，2015 | [資訊名詞－兩岸中小學教科書學術名詞](https://data.gov.tw/dataset/15406) | 15406 |
| 國家教育研究院，2015 | [管理學學術名詞](https://data.gov.tw/dataset/15440) | 15440 |
| 國家教育研究院，2015 | [市場學學術名詞](https://data.gov.tw/dataset/15212) | 15212 |
| 國家教育研究院，2015 | [經濟學學術名詞](https://data.gov.tw/dataset/15405) | 15405 |
| 中央銀行，2024 | [中央銀行雙語詞彙](https://data.gov.tw/dataset/170729) | 170729 |

上述资料由提供机关依政府資料開放授權條款释出；本项目不是这些机关的官方产品，也不代表它们认可本项目。其他 `*-modern.json` 精选词表和 `programming.json` 中标为 `extension` 的条目由本项目整理。

## 构建依赖

术语构建工具使用 [opencc-js](https://github.com/nk2028/opencc-js) 转换繁简文字。它是构建依赖，不作为扩展运行时代码打包；其上游项目列示的许可证为 MIT / Apache 2.0，具体以其发布包附带的许可文件为准。
