pipeline {
  agent {
    kubernetes {
      yaml """
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: kaniko
      image: gcr.io/kaniko-project/executor:debug
      command:
        - /busybox/cat
      tty: true
      volumeMounts:
        - name: docker-config
          mountPath: /kaniko/.docker
  volumes:
    - name: docker-config
      secret:
        secretName: TODO_HARBOR_DOCKERCONFIG_SECRET
"""
    }
  }

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  parameters {
    string(name: 'IMAGE_TAG', defaultValue: '', description: '비워두면 git short sha를 이미지 태그로 사용합니다.')
    booleanParam(name: 'RUN_TESTS', defaultValue: false, description: 'TODO: 테스트 스크립트 추가 후 true로 전환하세요.')
    booleanParam(name: 'PUSH_IMAGE', defaultValue: true, description: 'main 브랜치에서 Harbor 이미지 push 여부')
    booleanParam(name: 'DEPLOY', defaultValue: false, description: 'main 브랜치에서만 배포 연동을 실행합니다.')
  }

  environment {
    HARBOR_REGISTRY = 'TODO_HARBOR_REGISTRY'
    HARBOR_PROJECT = 'TODO_HARBOR_PROJECT'
    HARBOR_DOCKERCONFIG_SECRET = 'TODO_HARBOR_DOCKERCONFIG_SECRET'
    IMAGE_PREFIX = 'team9-'
    IMAGE_NAME = 'redis-stream-mongo-consumer'
    DOCKER_CONTEXT = '.'
    DOCKERFILE = 'Dockerfile'
    PLATFORM = 'linux/amd64'
    TEST_COMMAND = 'TODO_ADD_TEST_COMMAND'
    DEPLOY_TARGET = 'TODO_ARGOCD_APP_OR_MANIFEST_REPO'
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Prepare') {
      steps {
        script {
          env.RESOLVED_IMAGE_TAG = params.IMAGE_TAG?.trim()
            ? params.IMAGE_TAG.trim()
            : sh(returnStdout: true, script: 'git rev-parse --short=12 HEAD').trim()
          env.IMAGE_REF = "${env.HARBOR_REGISTRY}/${env.HARBOR_PROJECT}/${env.IMAGE_PREFIX}${env.IMAGE_NAME}:${env.RESOLVED_IMAGE_TAG}"
          env.KANIKO_CACHE_REPO = "${env.HARBOR_REGISTRY}/${env.HARBOR_PROJECT}/kaniko-cache"
          echo "Image: ${env.IMAGE_REF}"
        }
      }
    }

    stage('Test') {
      when { expression { return params.RUN_TESTS } }
      steps {
        error 'TODO: package.json의 test 스크립트를 실제 검증 명령으로 교체한 뒤 TEST_COMMAND를 설정하세요.'
      }
    }

    stage('PR Image Build Check') {
      when { changeRequest target: 'main' }
      steps {
        container('kaniko') {
          sh '''
            /kaniko/executor \
              --context "$WORKSPACE/$DOCKER_CONTEXT" \
              --dockerfile "$WORKSPACE/$DOCKERFILE" \
              --custom-platform "$PLATFORM" \
              --no-push \
              --no-push-cache
          '''
        }
      }
    }

    stage('Main Image Push') {
      when {
        allOf {
          branch 'main'
          expression { return params.PUSH_IMAGE }
        }
      }
      steps {
        container('kaniko') {
          sh '''
            /kaniko/executor \
              --context "$WORKSPACE/$DOCKER_CONTEXT" \
              --dockerfile "$WORKSPACE/$DOCKERFILE" \
              --custom-platform "$PLATFORM" \
              --destination "$IMAGE_REF" \
              --cache=true \
              --cache-repo "$KANIKO_CACHE_REPO"
          '''
        }
      }
    }

    stage('Deploy') {
      when {
        allOf {
          branch 'main'
          expression { return params.DEPLOY }
        }
      }
      steps {
        echo 'TODO: manifest repo image tag update 또는 ArgoCD sync를 여기에 연결하세요.'
        echo "TODO target: ${env.DEPLOY_TARGET}"
      }
    }
  }
}
