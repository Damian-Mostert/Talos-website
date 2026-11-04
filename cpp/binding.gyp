{
  "targets": [
    {
      "target_name": "neuropile_core",
      "sources": [
        "src/addon.cpp",
        "src/neuropile_core.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "cflags_cc": [
        "-std=c++17",
        "-O3"
      ],
      "conditions": [
        [
          "OS=='win'",
          {
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": [
                  "/std:c++17",
                  "/utf-8",
                  "/O2",
                  "/Ob2",
                  "/Oi",
                  "/GL",
                  "/fp:fast"
                ],
                "Optimization": 2,
                "InlineFunctionExpansion": 3,
                "ExceptionHandling": 1
              }
            }
          }
        ],
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "GCC_OPTIMIZATION_LEVEL": "3",
              "OTHER_CFLAGS": [
                "-O3",
                "-ffast-math"
              ]
            }
          }
        ]
      ]
    }
  ]
}
